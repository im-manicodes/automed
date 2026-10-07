import { describe, expect, it } from 'vitest';
import {
  E2eError,
  ReplayGuard,
  deriveKeys,
  generateE2eKey,
  isValidE2eKey,
  openRequest,
  openResponse,
  sealRequest,
  sealResponse,
} from './e2e-crypto';
import type { E2eRequestHead } from './e2e-crypto';
import * as web from '../../web/src/lib/e2e';

const DEV = 'dev0123456789abcdefghij';
const keys = deriveKeys(generateE2eKey());
const head = (over: Partial<E2eRequestHead> = {}): E2eRequestHead => ({
  m: 'POST',
  p: '/api/auth/login',
  h: { cookie: 'am_access=tok', 'content-type': 'application/json' },
  t: Date.now(),
  ...over,
});
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof E2eError ? e.code : 'otro';
  }
  return 'sin error';
};

describe('cifrado E2E (escritorio, node:crypto)', () => {
  it('clave: 32 bytes en base64url', () => {
    expect(isValidE2eKey(generateE2eKey())).toBe(true);
    expect(isValidE2eKey('corta')).toBe(false);
    expect(() => deriveKeys('corta')).toThrow(E2eError);
  });

  it('ida y vuelta de petición y respuesta (binario incluido)', () => {
    const body = Buffer.from([0, 1, 2, 255, 254, 0]);
    const { wire, nonce } = sealRequest(keys, DEV, head(), body);
    const got = openRequest(keys, DEV, wire, new ReplayGuard(0));
    expect(got.head.p).toBe('/api/auth/login');
    expect(got.head.h.cookie).toBe('am_access=tok');
    expect(got.body.equals(body)).toBe(true);
    expect(got.nonce.equals(nonce)).toBe(true);

    const res = sealResponse(keys, DEV, nonce, { s: 200, h: { 'set-cookie': ['a=1', 'b=2'] } }, Buffer.from('%PDF-1.7 …'));
    const r = openResponse(keys, DEV, nonce, res);
    expect(r.head).toEqual({ s: 200, h: { 'set-cookie': ['a=1', 'b=2'] } });
    expect(r.body.toString()).toBe('%PDF-1.7 …');
  });

  it('el cable no contiene texto claro ni se repite (nonce único)', () => {
    const a = sealRequest(keys, DEV, head(), Buffer.from('paciente Juan Pérez'));
    const b = sealRequest(keys, DEV, head(), Buffer.from('paciente Juan Pérez'));
    expect(a.wire.toString('latin1')).not.toContain('Juan');
    expect(a.wire.toString('latin1')).not.toContain('am_access');
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.wire.equals(b.wire)).toBe(false);
  });

  it('manipulación: cualquier bit cambiado se rechaza', () => {
    const { wire } = sealRequest(keys, DEV, head(), Buffer.from('hola'));
    for (const i of [0, 1, 13, wire.length - 1, Math.floor(wire.length / 2)]) {
      const bad = Buffer.from(wire);
      bad[i] ^= 1;
      expect(code(() => openRequest(keys, DEV, bad, new ReplayGuard(0)))).not.toBe('sin error');
    }
    expect(code(() => openRequest(keys, DEV, wire.subarray(0, 10), new ReplayGuard(0)))).toBe('formato');
  });

  it('clave errónea o deviceId distinto: no autentica', () => {
    const { wire } = sealRequest(keys, DEV, head(), Buffer.from('x'));
    expect(code(() => openRequest(deriveKeys(generateE2eKey()), DEV, wire, new ReplayGuard(0)))).toBe('autenticacion');
    expect(code(() => openRequest(keys, 'otro-dispositivo-0123456', wire, new ReplayGuard(0)))).toBe('autenticacion');
  });

  it('dirección: una respuesta no vale como petición ni al revés (sin reflejo)', () => {
    const { wire, nonce } = sealRequest(keys, DEV, head(), Buffer.from('x'));
    expect(() => openResponse(keys, DEV, nonce, wire)).toThrow(E2eError);
    const res = sealResponse(keys, DEV, nonce, { s: 200, h: {} }, Buffer.from('x'));
    expect(code(() => openRequest(keys, DEV, res, new ReplayGuard(0)))).toBe('autenticacion');
  });

  it('repetición: el mismo sobre dos veces se rechaza', () => {
    const { wire } = sealRequest(keys, DEV, head(), Buffer.from('x'));
    const g = new ReplayGuard(0);
    openRequest(keys, DEV, wire, g);
    expect(code(() => openRequest(keys, DEV, wire, g))).toBe('repetido');
  });

  it('marca de tiempo vieja, futura o anterior al arranque: se rechaza', () => {
    const now = 1_000_000_000_000;
    const mk = (t: number) => sealRequest(keys, DEV, head({ t }), Buffer.alloc(0)).wire;
    expect(code(() => openRequest(keys, DEV, mk(now - 6 * 60_000), new ReplayGuard(0), now))).toBe('reloj');
    expect(code(() => openRequest(keys, DEV, mk(now + 6 * 60_000), new ReplayGuard(0), now))).toBe('reloj');
    expect(code(() => openRequest(keys, DEV, mk(now - 1000), new ReplayGuard(now), now))).toBe('reloj');
    expect(code(() => openRequest(keys, DEV, mk(now - 1000), new ReplayGuard(0), now))).toBe('sin error');
  });

  it('la respuesta va atada a su petición: no sirve para otra', () => {
    const a = sealRequest(keys, DEV, head(), Buffer.from('a'));
    const b = sealRequest(keys, DEV, head(), Buffer.from('b'));
    const resA = sealResponse(keys, DEV, a.nonce, { s: 200, h: {} }, Buffer.from('respuesta de A'));
    expect(openResponse(keys, DEV, a.nonce, resA).body.toString()).toBe('respuesta de A');
    expect(() => openResponse(keys, DEV, b.nonce, resA)).toThrow(E2eError);
  });

  it('el guardián limita su memoria', () => {
    const g = new ReplayGuard(0, 3);
    const now = Date.now();
    for (let i = 0; i < 3; i++) g.check(Buffer.from([i]), now, now);
    expect(code(() => g.check(Buffer.from([9]), now, now))).toBe('repetido');
  });
});

describe('interoperabilidad navegador (WebCrypto) <-> escritorio (node:crypto)', () => {
  const keyB64 = generateE2eKey();

  it('petición del navegador la abre el escritorio y la respuesta vuelve al navegador', async () => {
    const wk = await web.deriveKeys(keyB64);
    const dk = deriveKeys(keyB64);
    const body = new TextEncoder().encode('{"email":"a@b.c"}');
    const { wire, nonce } = await web.sealRequest(wk, DEV, { m: 'POST', p: '/api/auth/login', h: { cookie: 'x=1' }, t: Date.now() }, body);
    const opened = openRequest(dk, DEV, Buffer.from(wire), new ReplayGuard(0));
    expect(opened.head).toMatchObject({ m: 'POST', p: '/api/auth/login', h: { cookie: 'x=1' } });
    expect(opened.body.toString()).toBe('{"email":"a@b.c"}');

    const res = sealResponse(dk, DEV, opened.nonce, { s: 201, h: { 'content-type': 'application/json' } }, Buffer.from('{"ok":true}'));
    const back = await web.openResponse(wk, DEV, nonce, new Uint8Array(res));
    expect(back.head.s).toBe(201);
    expect(new TextDecoder().decode(back.body)).toBe('{"ok":true}');
  });

  it('el navegador rechaza una respuesta con clave errónea o de otra petición', async () => {
    const wk = await web.deriveKeys(keyB64);
    const dk = deriveKeys(keyB64);
    const { nonce } = await web.sealRequest(wk, DEV, { m: 'GET', p: '/api/x', h: {}, t: Date.now() }, new Uint8Array(0));
    const other = await web.sealRequest(wk, DEV, { m: 'GET', p: '/api/y', h: {}, t: Date.now() }, new Uint8Array(0));
    const good = sealResponse(dk, DEV, Buffer.from(nonce), { s: 200, h: {} }, Buffer.from('ok'));
    await expect(web.openResponse(wk, DEV, other.nonce, new Uint8Array(good))).rejects.toThrow(web.E2eError);
    const evil = sealResponse(deriveKeys(generateE2eKey()), DEV, Buffer.from(nonce), { s: 200, h: {} }, Buffer.from('ok'));
    await expect(web.openResponse(wk, DEV, nonce, new Uint8Array(evil))).rejects.toThrow(web.E2eError);
  });
});
