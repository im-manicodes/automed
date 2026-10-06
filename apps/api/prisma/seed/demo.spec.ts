import { fakePrisma } from '../../test/helpers/fake-prisma';
import {
  DEMO_PREFIX,
  DEMO_S3_PREFIX,
  DEMO_SUBJECT_PREFIX,
} from './demo-constants';
import { buildDemoDataset } from './demo-data';
import { cleanDemo, seedDemo, type DemoStorage } from './demo';

const asDb = (d: unknown) => d as any;

function fakeStorage(healthy = true) {
  const objects = new Map<string, number>();
  const s: DemoStorage & { objects: Map<string, number> } = {
    objects,
    isHealthy: () => Promise.resolve(healthy),
    put: (k, b) => {
      objects.set(k, b.length);
      return Promise.resolve();
    },
    deleteByPrefix: (p) => {
      let n = 0;
      for (const k of [...objects.keys()])
        if (k.startsWith(p)) {
          objects.delete(k);
          n++;
        }
      return Promise.resolve(n);
    },
  };
  return s;
}

const render = () => Buffer.from('png');
const noop = () => undefined;

describe('dataset demo', () => {
  const ds = buildDemoDataset(new Date('2026-01-10T12:00:00Z'));

  it('todo está marcado como demo', () => {
    const rows = [
      ds.template,
      ds.account,
      ...ds.threads,
      ...ds.messages,
      ...ds.attachments,
      ...ds.regions,
      ...ds.syntheses,
    ] as { id: string }[];
    for (const r of rows) expect(r.id.startsWith(DEMO_PREFIX)).toBe(true);
    for (const p of ds.pages) expect(p.id.startsWith(DEMO_PREFIX)).toBe(true);
    for (const t of ds.threads as { subject: string }[]) {
      expect(t.subject.startsWith(DEMO_SUBJECT_PREFIX)).toBe(true);
    }
    expect((ds.account as any).tokenEnc).toBeNull();
    for (const a of ds.attachments as any[])
      expect(a.storageKey.startsWith(DEMO_S3_PREFIX)).toBe(true);
  });

  it('cubre los estados pedidos y casos de síntesis/revisión', () => {
    const th = ds.threads as any[];
    const states = new Set(th.map((t) => t.status));
    for (const s of [
      'sin_analizar',
      'procesando',
      'listo',
      'necesita_revision',
      'error',
    ]) {
      expect(states.has(s)).toBe(true);
    }
    expect(th.some((t) => t.tieneMensajesNuevos)).toBe(true);
    expect(th.some((t) => t.seguimiento)).toBe(true);
    const sy = ds.syntheses as any[];
    expect(sy.some((s) => s.mode === 'full')).toBe(true);
    expect(sy.some((s) => s.mode === 'incremental' && s.baseSynthesisId)).toBe(
      true,
    );
    const rg = ds.regions as any[];
    expect(rg.some((r) => r.status === 'dudoso')).toBe(true);
    expect(rg.some((r) => r.status === 'corregido' && r.userText)).toBe(true);
    const msgs = ds.messages as any[];
    expect(msgs.some((m) => m.isFromMe)).toBe(true);
    expect(msgs.some((m) => !m.isFromMe)).toBe(true);
  });

  it('bbox normalizadas dentro de la página y ids únicos', () => {
    for (const r of ds.regions as any[]) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1);
      expect(r.y + r.h).toBeLessThanOrEqual(1);
    }
    const ids = [...ds.messages, ...ds.regions, ...ds.attachments].map(
      (r: any) => r.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('seedDemo / cleanDemo', () => {
  it('se niega en producción sin tocar nada', async () => {
    const db = fakePrisma();
    await expect(
      seedDemo(
        asDb(db),
        fakeStorage(),
        { NODE_ENV: 'production' },
        noop,
        render,
      ),
    ).rejects.toThrow('production');
    expect(db.thread.rows).toHaveLength(0);
  });

  it('crea el demo, es re-ejecutable y sube las imágenes', async () => {
    const db = fakePrisma();
    const st = fakeStorage();
    const a = await seedDemo(asDb(db), st, {}, noop, render);
    const n = db.thread.rows.length;
    expect(n).toBe(a.tickets);
    expect(st.objects.size).toBe(a.paginas);
    expect(a.imagenesSubidas).toBe(a.paginas);
    const b = await seedDemo(asDb(db), st, {}, noop, render);
    expect(db.thread.rows).toHaveLength(n);
    expect(db.ocrRegion.rows).toHaveLength(b.regiones);
    for (const kind of ['resumen', 'whatsapp'])
      expect(
        db.template.rows.filter((t) => t.isActive && t.kind === kind),
      ).toHaveLength(1);
  });

  it('si RustFS no está disponible omite solo las imágenes y avisa', async () => {
    const db = fakePrisma();
    const out: string[] = [];
    const r = await seedDemo(
      asDb(db),
      fakeStorage(false),
      {},
      (m) => out.push(m),
      render,
    );
    expect(r.imagenesSubidas).toBe(0);
    expect(db.thread.rows.length).toBeGreaterThan(0);
    expect(out.join('\n')).toContain('RustFS/S3 no disponible');
  });

  it('clean borra solo lo demo (BD y S3) y deja el resto', async () => {
    const db = fakePrisma();
    const st = fakeStorage();
    const real = await db.mailAccount.create({
      data: { email: 'real@x.com', tokenEnc: 'e' },
    });
    const realThread = await db.thread.create({
      data: { accountId: real.id, conversationId: 'c', subject: 'Real' },
    });
    await db.template.create({
      data: { name: 'Mía', markdown: '# x', version: 2 },
    });
    st.objects.set('attachments/real.pdf', 1);
    await seedDemo(asDb(db), st, {}, noop, render);
    await cleanDemo(asDb(db), st, noop);
    expect(db.thread.rows.map((t) => t.id)).toEqual([realThread.id]);
    expect(db.mailAccount.rows.map((a) => a.id)).toEqual([real.id]);
    // 'Mía' (resumen) intacta; la de whatsapp la creó el seed base (no es demo) y se conserva
    expect(db.template.rows.map((t) => t.name)).toEqual([
      'Mía',
      'Formato de WhatsApp estándar',
    ]);
    for (const t of [
      db.message,
      db.attachment,
      db.ocrPage,
      db.ocrRegion,
      db.synthesis,
    ]) {
      expect(t.rows).toHaveLength(0);
    }
    expect([...st.objects.keys()]).toEqual(['attachments/real.pdf']);
  });
});
