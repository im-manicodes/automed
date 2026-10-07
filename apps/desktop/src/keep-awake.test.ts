import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RelayManager } from './relay-manager';
import { generateSecrets } from './secrets';
import { KeepAwake } from './keep-awake';
import type { PowerBlockerLike } from './keep-awake';

function fakeBlocker() {
  const active = new Set<number>();
  let next = 1;
  const b: PowerBlockerLike & { active: Set<number>; starts: number } = {
    active,
    starts: 0,
    start: () => {
      b.starts++;
      active.add(next);
      return next++;
    },
    stop: (id) => void active.delete(id),
    isStarted: (id) => active.has(id),
  };
  return b;
}

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'automed-ka-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('KeepAwake', () => {
  it('desactivado por defecto: no bloquea aunque el túnel esté activo', () => {
    const b = fakeBlocker();
    const k = new KeepAwake(tmp(), b);
    expect(k.preferencia).toBe(false);
    k.sync(true);
    expect(b.active.size).toBe(0);
  });

  it('bloquea solo con preferencia + túnel activo, sin duplicar, y suelta al apagar el túnel', () => {
    const b = fakeBlocker();
    const k = new KeepAwake(tmp(), b);
    k.setPreferencia(true, false);
    expect(b.active.size).toBe(0);
    k.sync(true);
    k.sync(true);
    expect(b.starts).toBe(1);
    expect(k.aplicado).toBe(true);
    k.sync(false);
    expect(b.active.size).toBe(0);
    expect(k.aplicado).toBe(false);
    k.setPreferencia(false, true);
    expect(b.active.size).toBe(0);
  });

  it('persiste la preferencia entre arranques', () => {
    const dir = tmp();
    new KeepAwake(dir, fakeBlocker()).setPreferencia(true, false);
    expect(new KeepAwake(dir, fakeBlocker()).preferencia).toBe(true);
  });
});

describe('RelayManager + KeepAwake', () => {
  it('el bloqueo rige solo mientras el túnel está activo; desvincular lo suelta', async () => {
    const b = fakeBlocker();
    const m = new RelayManager({
      relayUrl: 'http://127.0.0.1:9',
      secrets: generateSecrets(),
      persist: () => {},
      keepAwake: new KeepAwake(tmp(), b),
      backoff: { minMs: 50, maxMs: 200 },
    });
    expect(m.status().mantenerDespierto).toBe(false);
    expect(m.setKeepAwake(true).mantenerDespierto).toBe(true);
    expect(b.active.size).toBe(0); // túnel aún no activo
    m.enable();
    expect(b.active.size).toBe(1);
    await m.disable();
    expect(b.active.size).toBe(0);
    expect(m.status().mantenerDespierto).toBe(true); // la preferencia se conserva
    m.stop();
  });
});
