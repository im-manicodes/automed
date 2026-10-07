// Tipos de boot.js (solo para los tests; el arranque en sí no tiene build).
export class FrontError extends Error {
  code: string;
  constructor(code: string, message?: string);
}
export const MENSAJES: Record<string, [string, string]>;
export interface E2eKeys {
  c2d: CryptoKey;
  d2c: CryptoKey;
}
export interface FrontManifest {
  v: 1;
  d: string;
  version: string;
  builtAt: number;
  entry: { scripts: string[]; styles: string[] };
  files: Record<string, { sha256: string; size: number; type: string }>;
}
export interface FrontCtx {
  base: string;
  deviceId: string;
  keys: E2eKeys;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  now: () => number;
}
export interface FrontStore {
  floor(): { builtAt: number; mh: string } | null | Promise<{ builtAt: number; mh: string } | null>;
  current(): Promise<{ mh: string; manifest: FrontManifest } | null>;
  commit(x: { manifest: FrontManifest; mh: string; files: Map<string, Uint8Array>; reuse: string[] }): Promise<void>;
}
export function b64urlToBytes(s: string): Uint8Array;
export function isValidKey(k: unknown): boolean;
export function deriveKeys(keyB64u: string | null): Promise<E2eKeys>;
export function sealRequest(keys: E2eKeys, deviceId: string, head: { m: string; p: string; h: Record<string, string>; t: number }, body?: Uint8Array): Promise<{ wire: Uint8Array; nonce: Uint8Array }>;
export function openResponse(keys: E2eKeys, deviceId: string, reqNonce: Uint8Array, wire: Uint8Array): Promise<{ status: number; headers: Record<string, string | string[]>; body: Uint8Array }>;
export function sha256Hex(bytes: Uint8Array): Promise<string>;
export function fetchSealed(ctx: FrontCtx, path: string): Promise<{ status: number; headers: Record<string, string | string[]>; body: Uint8Array }>;
export function verifyManifest(raw: Uint8Array, o: { deviceId: string; floor: { builtAt: number; mh: string } | null }): Promise<{ manifest: FrontManifest; mh: string }>;
export function syncFront(ctx: FrontCtx, store: FrontStore): Promise<{ source: 'cache' | 'red'; manifest: FrontManifest }>;
export function browserStore(base: string, deviceId: string, env?: unknown): FrontStore & { reset(): Promise<void> };
export function detectBase(pathname: string): string;
export function run(env?: unknown): Promise<void>;
