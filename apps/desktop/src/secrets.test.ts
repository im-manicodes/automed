import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadOrCreateSecrets, saveSecrets, type SafeStorageLike } from './secrets';

const fakeSafe = (backend?: string, available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(s, 'utf8').reverse(),
  decryptString: (b) => Buffer.from(b).reverse().toString('utf8'),
  getSelectedStorageBackend: backend ? () => backend : undefined,
});
const tmp = () => mkdtempSync(join(tmpdir(), 'automed-sec-'));

describe('secrets', () => {
  it('genera y guarda cifrado en el primer arranque, con permisos 0600', () => {
    const dir = tmp();
    const r = loadOrCreateSecrets(dir, fakeSafe('gnome_libsecret'));
    expect(r.created).toBe(true);
    expect(r.warning).toBeUndefined();
    expect(r.secrets.jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect(Buffer.from(r.secrets.tokenEncKey, 'base64')).toHaveLength(32);
    const raw = readFileSync(join(dir, 'secrets.bin'));
    expect(raw[0]).toBe(0x45);
    expect(raw.toString('utf8')).not.toContain(r.secrets.jwtSecret);
    if (process.platform !== 'win32') expect(statSync(join(dir, 'secrets.bin')).mode & 0o777).toBe(0o600);
  });

  it('lee los mismos secretos en el segundo arranque', () => {
    const dir = tmp();
    const a = loadOrCreateSecrets(dir, fakeSafe());
    const b = loadOrCreateSecrets(dir, fakeSafe());
    expect(b.created).toBe(false);
    expect(b.secrets).toEqual(a.secrets);
  });

  it('sin safeStorage guarda en archivo 0600 y avisa (sin incluir el secreto)', () => {
    const dir = tmp();
    const r = loadOrCreateSecrets(dir, null);
    expect(r.warning).toBeTruthy();
    expect(r.warning).not.toContain(r.secrets.jwtSecret);
    expect(readFileSync(join(dir, 'secrets.bin'))[0]).toBe(0x50);
    expect(loadOrCreateSecrets(dir, null).secrets).toEqual(r.secrets);
  });

  it('backend basic_text en Linux se trata como no seguro', () => {
    const r = loadOrCreateSecrets(tmp(), fakeSafe('basic_text'));
    expect(r.warning).toBeTruthy();
  });

  it('migra de texto plano a cifrado cuando safeStorage pasa a estar disponible', () => {
    const dir = tmp();
    const a = loadOrCreateSecrets(dir, fakeSafe('basic_text'));
    const b = loadOrCreateSecrets(dir, fakeSafe('kwallet5'));
    expect(b.secrets).toEqual(a.secrets);
    expect(readFileSync(join(dir, 'secrets.bin'))[0]).toBe(0x45);
  });

  it('no regenera si no se puede descifrar ni si está dañado', () => {
    const dir = tmp();
    loadOrCreateSecrets(dir, fakeSafe());
    const bad: SafeStorageLike = { ...fakeSafe(), decryptString: () => { throw new Error('x'); } };
    expect(() => loadOrCreateSecrets(dir, bad)).toThrow(/claves guardadas/);
    writeFileSync(join(dir, 'secrets.bin'), Buffer.from([0x50, 0x7b, 0x7d]));
    expect(() => loadOrCreateSecrets(dir, null)).toThrow(/dañado/);
  });

  it('guarda y recupera la identidad del relay (cifrada)', () => {
    const dir = tmp();
    const ss = fakeSafe('gnome_libsecret');
    const first = loadOrCreateSecrets(dir, ss).secrets;
    saveSecrets(dir, ss, { ...first, relay: { deviceId: 'd'.repeat(22), secret: 'Ab1'.repeat(14), enabled: true } });
    expect(readFileSync(join(dir, 'secrets.bin')).toString('utf8')).not.toContain('Ab1'.repeat(14));
    const again = loadOrCreateSecrets(dir, ss).secrets;
    expect(again.relay).toEqual({ deviceId: 'd'.repeat(22), secret: 'Ab1'.repeat(14), enabled: true });
    expect(again.jwtSecret).toBe(first.jwtSecret);
  });
});
