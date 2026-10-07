import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceRegistry } from './devices';

const ID = 'a'.repeat(22);
const SECRET = 's'.repeat(43);
let dir = '';
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe('DeviceRegistry', () => {
  it('confía en el primer uso y luego exige el mismo secreto', () => {
    const r = new DeviceRegistry();
    expect(r.verify(ID, SECRET)).toBe('new');
    r.register(ID, SECRET);
    expect(r.verify(ID, SECRET)).toBe('ok');
    expect(r.verify(ID, 'x'.repeat(43))).toBe('bad');
  });

  it('rechaza formatos inválidos y respeta el tope', () => {
    const r = new DeviceRegistry(undefined, 1);
    expect(r.verify('corto', SECRET)).toBe('bad');
    expect(r.verify(ID, 'corto')).toBe('bad');
    r.register(ID, SECRET);
    expect(r.verify('b'.repeat(22), SECRET)).toBe('bad');
  });

  it('persiste solo el hash y permite olvidar', () => {
    dir = mkdtempSync(join(tmpdir(), 'relay-'));
    const file = join(dir, 'devices.json');
    const r = new DeviceRegistry(file);
    r.register(ID, SECRET);
    expect(readFileSync(file, 'utf8')).not.toContain(SECRET);
    const r2 = new DeviceRegistry(file);
    expect(r2.verify(ID, SECRET)).toBe('ok');
    r2.remove(ID);
    // Desvincular = revocado: el deviceId no se puede volver a registrar (el QR viejo no resucita).
    expect(new DeviceRegistry(file).verify(ID, SECRET)).toBe('bad');
    expect(new DeviceRegistry(file).verify('c'.repeat(22), SECRET)).toBe('new');
  });

  it('lee el formato de la fase 1 ({deviceId: hash}) sin perder dispositivos', () => {
    dir = mkdtempSync(join(tmpdir(), 'relay-'));
    const file = join(dir, 'devices.json');
    const r = new DeviceRegistry(file);
    r.register(ID, SECRET);
    const nuevo = JSON.parse(readFileSync(file, 'utf8')) as { devices: Record<string, string> };
    writeFileSync(file, JSON.stringify(nuevo.devices));
    expect(new DeviceRegistry(file).verify(ID, SECRET)).toBe('ok');
  });
});
