import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  FrameType,
  MAX_FRAME_BYTES,
  ProtocolError,
  RateLimiter,
  SendWindow,
  decodeFrame,
  encodeCredit,
  encodeFrame,
  encodeJson,
  filterHeaders,
  parseCredit,
  parseReqHead,
  parseResHead,
  splitChunks,
} from './protocol';

describe('frames', () => {
  it('ida y vuelta', () => {
    const f = decodeFrame(encodeFrame(FrameType.ReqBody, 0xfffffffe, Buffer.from('hola')));
    expect(f.type).toBe(FrameType.ReqBody);
    expect(f.streamId).toBe(0xfffffffe);
    expect(f.payload.toString()).toBe('hola');
  });

  it('sin carga', () => {
    const f = decodeFrame(encodeFrame(FrameType.ReqEnd, 7));
    expect(f.payload.length).toBe(0);
  });

  it('JSON y crédito', () => {
    const h = decodeFrame(encodeJson(FrameType.ReqHead, 1, { method: 'GET', path: '/api/x', headers: { a: 'b' } }));
    expect(parseReqHead(h.payload)).toEqual({ method: 'GET', path: '/api/x', headers: { a: 'b' } });
    expect(parseCredit(decodeFrame(encodeCredit(3, 65536)).payload)).toBe(65536);
  });

  it('rechaza frames inválidos', () => {
    expect(() => decodeFrame(Buffer.from([1, 0]))).toThrow(ProtocolError);
    expect(() => decodeFrame(Buffer.from([99, 0, 0, 0, 1]))).toThrow(ProtocolError);
    expect(() => decodeFrame(Buffer.alloc(MAX_FRAME_BYTES + 1, 1))).toThrow(ProtocolError);
    expect(() => encodeFrame(FrameType.ReqBody, 1, Buffer.alloc(MAX_FRAME_BYTES))).toThrow(ProtocolError);
    expect(() => parseCredit(Buffer.from([1]))).toThrow(ProtocolError);
  });

  it('valida cabeceras de petición y respuesta', () => {
    expect(() => parseReqHead(Buffer.from('{"method":"GET","path":"x","headers":{}}'))).toThrow(ProtocolError);
    expect(() => parseReqHead(Buffer.from('no json'))).toThrow(ProtocolError);
    expect(() => parseResHead(Buffer.from('{"status":99,"headers":{}}'))).toThrow(ProtocolError);
    expect(parseResHead(Buffer.from('{"status":204,"headers":{}}')).status).toBe(204);
  });

  it('parte cuerpos en trozos', () => {
    const parts = [...splitChunks(Buffer.alloc(CHUNK_SIZE * 2 + 10))];
    expect(parts.map((p) => p.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 10]);
    expect([...splitChunks(Buffer.alloc(0))]).toEqual([]);
  });
});

describe('filterHeaders', () => {
  it('quita cabeceras de salto y las de Connection', () => {
    const out = filterHeaders(
      { Connection: 'keep-alive, X-Foo', 'Transfer-Encoding': 'chunked', 'X-Foo': '1', Cookie: 'a=b', Host: 'x' },
      ['host'],
    );
    expect(out).toEqual({ cookie: 'a=b' });
  });
});

describe('SendWindow', () => {
  it('espera crédito y lo libera en orden', async () => {
    const w = new SendWindow(10);
    await w.take(10);
    const order: number[] = [];
    const a = w.take(6).then(() => order.push(1));
    const b = w.take(4).then(() => order.push(2));
    await Promise.resolve();
    expect(order).toEqual([]);
    w.grant(6);
    await a;
    w.grant(4);
    await b;
    expect(order).toEqual([1, 2]);
  });

  it('close rechaza a los que esperan', async () => {
    const w = new SendWindow(1);
    await w.take(1);
    const p = w.take(1);
    w.close();
    await expect(p).rejects.toThrow();
    await expect(w.take(1)).rejects.toThrow();
  });
});

describe('RateLimiter', () => {
  it('limita por clave y ventana', () => {
    let t = 0;
    const r = new RateLimiter(2, 1000, () => t);
    expect([r.hit('a'), r.hit('a'), r.hit('a'), r.hit('b')]).toEqual([true, true, false, true]);
    t = 1001;
    expect(r.hit('a')).toBe(true);
  });
});

describe('ReqHead con IP real', () => {
  it('acepta ip opcional de texto y rechaza otros tipos', () => {
    const base = { method: 'POST', path: '/e', headers: {} };
    expect(parseReqHead(Buffer.from(JSON.stringify({ ...base, ip: '203.0.113.9' }))).ip).toBe('203.0.113.9');
    expect(parseReqHead(Buffer.from(JSON.stringify(base))).ip).toBeUndefined();
    expect(() => parseReqHead(Buffer.from(JSON.stringify({ ...base, ip: 5 })))).toThrow(ProtocolError);
    expect(() => parseReqHead(Buffer.from(JSON.stringify({ ...base, ip: 'x'.repeat(100) })))).toThrow(ProtocolError);
  });
});
