import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebSocket } from 'ws';
import {
  FrameType,
  MAX_STREAMS_PER_DEVICE,
  ProtocolError,
  SendWindow,
  decodeFrame,
  encodeCredit,
  encodeFrame,
  encodeJson,
  filterHeaders,
  parseCredit,
  parseJson,
  parseResHead,
  splitChunks,
} from './protocol';
import type { AbortPayload } from './protocol';
import { rewriteSetCookie } from './http-util';

export interface TunnelOptions {
  /** Tope del cuerpo de una petición del celular (el front solo envía JSON pequeño). */
  maxRequestBytes: number;
  /** Segundos sin cabecera de respuesta antes de 504. */
  headTimeoutMs: number;
  /** Silencio máximo con la respuesta a medias. */
  idleTimeoutMs: number;
  /** Añade Secure a las cookies (el relay público va con HTTPS). */
  cookieSecure: boolean;
  onUnregister: () => void;
}

interface Stream {
  res: ServerResponse;
  window: SendWindow;
  headSent: boolean;
  finished: boolean;
  timer: NodeJS.Timeout | null;
}

/** Código estable (sin datos) para que la web distinga «computadora apagada / sin respuesta» de otros errores. */
export const CODIGO_PC_APAGADA = 'pc_apagada';

function jsonError(res: ServerResponse, status: number, message: string, code?: string) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = JSON.stringify(code ? { statusCode: status, code, message } : { statusCode: status, message });
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

/** Una conexión WSS de un escritorio: reparte las peticiones HTTP del celular en streams. */
export class Tunnel {
  private readonly streams = new Map<number, Stream>();
  private nextId = 1;
  alive = true;

  constructor(
    readonly deviceId: string,
    private readonly ws: WebSocket,
    private readonly base: string,
    private readonly opts: TunnelOptions,
  ) {
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return this.ws.close(1003, 'solo binario');
      try {
        this.onFrame(decodeFrame(data as Buffer));
      } catch (e) {
        if (e instanceof ProtocolError) this.ws.close(1002, 'protocolo');
        else throw e;
      }
    });
    ws.on('close', () => this.closeAll());
    ws.on('error', () => this.closeAll());
  }

  get activeStreams() {
    return this.streams.size;
  }

  private send(frame: Buffer) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(frame);
  }

  /** Reenvía una petición HTTP del celular por el túnel y devuelve la respuesta en streaming. */
  proxy(req: IncomingMessage, res: ServerResponse, path: string, ip?: string): void {
    if (this.streams.size >= MAX_STREAMS_PER_DEVICE) {
      return jsonError(res, 503, 'Hay demasiadas peticiones a la vez. Intenta de nuevo en un momento.');
    }
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > this.opts.maxRequestBytes) return jsonError(res, 413, 'La petición es demasiado grande.');

    const id = this.nextId;
    this.nextId = (this.nextId + 1) >>> 0 || 1;
    const stream: Stream = { res, window: new SendWindow(), headSent: false, finished: false, timer: null };
    this.streams.set(id, stream);
    this.armTimer(id, this.opts.headTimeoutMs);

    res.on('close', () => {
      if (!stream.finished) {
        this.send(encodeFrame(FrameType.Abort, id));
        this.end(id);
      }
    });

    this.send(
      encodeJson(FrameType.ReqHead, id, {
        method: req.method ?? 'GET',
        path,
        // Mínimo: nada del navegador (cookies, Authorization, User-Agent…) cruza el túnel.
        headers: { 'content-type': 'application/octet-stream' },
        ip,
      }),
    );

    void this.pumpBody(id, stream, req);
  }

  private async pumpBody(id: number, stream: Stream, req: IncomingMessage) {
    let total = 0;
    try {
      for await (const chunk of req as AsyncIterable<Buffer>) {
        total += chunk.length;
        if (total > this.opts.maxRequestBytes) {
          this.send(encodeFrame(FrameType.Abort, id));
          jsonError(stream.res, 413, 'La petición es demasiado grande.');
          this.end(id);
          return;
        }
        for (const part of splitChunks(chunk)) {
          await stream.window.take(part.length);
          this.send(encodeFrame(FrameType.ReqBody, id, part));
        }
      }
      this.send(encodeFrame(FrameType.ReqEnd, id));
    } catch {
      // Cancelado (cierre del stream o del celular): nada que hacer.
    }
  }

  private armTimer(id: number, ms: number) {
    const s = this.streams.get(id);
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      this.send(encodeFrame(FrameType.Abort, id));
      jsonError(s.res, 504, 'Tu computadora tardó demasiado en responder.', CODIGO_PC_APAGADA);
      this.end(id);
    }, ms);
    s.timer.unref();
  }

  private end(id: number) {
    const s = this.streams.get(id);
    if (!s) return;
    s.finished = true;
    if (s.timer) clearTimeout(s.timer);
    s.window.close();
    this.streams.delete(id);
  }

  private onFrame(f: ReturnType<typeof decodeFrame>) {
    if (f.type === FrameType.Unregister) {
      this.opts.onUnregister();
      this.ws.close(1000, 'desvinculado');
      return;
    }
    const s = this.streams.get(f.streamId);
    if (!s) return; // stream ya cerrado: se ignora (carreras normales tras Abort)
    switch (f.type) {
      case FrameType.Credit:
        s.window.grant(parseCredit(f.payload));
        break;
      case FrameType.ResHead: {
        if (s.headSent) throw new ProtocolError('cabecera repetida');
        const head = parseResHead(f.payload);
        const headers = filterHeaders(head.headers);
        const cookies = headers['set-cookie'];
        if (cookies) {
          headers['set-cookie'] = (Array.isArray(cookies) ? cookies : [cookies]).map((c) =>
            rewriteSetCookie(c, this.base, this.opts.cookieSecure),
          );
        }
        if (!headers['cache-control']) headers['cache-control'] = 'no-store';
        headers['x-content-type-options'] = 'nosniff';
        s.headSent = true;
        s.res.writeHead(head.status, headers);
        this.armTimer(f.streamId, this.opts.idleTimeoutMs);
        break;
      }
      case FrameType.ResBody: {
        if (!s.headSent) throw new ProtocolError('cuerpo sin cabecera');
        const n = f.payload.length;
        const ok = s.res.write(f.payload);
        const credit = () => this.send(encodeCredit(f.streamId, n));
        if (ok) credit();
        else s.res.once('drain', credit);
        this.armTimer(f.streamId, this.opts.idleTimeoutMs);
        break;
      }
      case FrameType.ResEnd:
        if (!s.headSent) throw new ProtocolError('fin sin cabecera');
        s.finished = true;
        s.res.end();
        this.end(f.streamId);
        break;
      case FrameType.Abort: {
        let msg: string | undefined;
        try {
          msg = parseJson<AbortPayload>(f.payload).message;
        } catch {
          msg = undefined;
        }
        jsonError(s.res, 502, msg ?? 'La aplicación de tu computadora no pudo responder.');
        this.end(f.streamId);
        break;
      }
      default:
        throw new ProtocolError('frame inesperado');
    }
  }

  private closeAll() {
    this.alive = false;
    for (const id of [...this.streams.keys()]) {
      const s = this.streams.get(id)!;
      jsonError(s.res, 502, 'Se perdió la conexión con tu computadora.', CODIGO_PC_APAGADA);
      this.end(id);
    }
  }

  close(code = 1000, reason = 'cerrado') {
    this.ws.close(code, reason);
  }
}
