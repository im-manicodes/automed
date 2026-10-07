import { randomUUID } from 'crypto';

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'NOT') return !matches(row, cond);
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond) return row[k] !== cond.not && row[k] != cond.not;
      if ('in' in cond) return cond.in.includes(row[k]);
      if ('lt' in cond) return row[k] < cond.lt;
      if ('startsWith' in cond)
        return typeof row[k] === 'string' && row[k].startsWith(cond.startsWith);
    }
    return row[k] === cond || (cond === null && row[k] == null);
  });
}

function table(defaults: () => Row = () => ({}), uniques: string[] = []) {
  const rows: Row[] = [];
  const find = (where: Row) => rows.find((r) => matches(r, where)) ?? null;
  return {
    rows,
    findUnique: ({ where }: any) => Promise.resolve(find(where)),
    findFirst: ({ where }: any = {}) => Promise.resolve(find(where)),
    findMany: ({ where }: any = {}) =>
      Promise.resolve(rows.filter((r) => matches(r, where))),
    upsert: ({ where, update, create }: any) => {
      const row = find(where);
      if (row) {
        Object.assign(row, update);
        return Promise.resolve(row);
      }
      const created = { id: randomUUID(), ...defaults(), ...create };
      rows.push(created);
      return Promise.resolve(created);
    },
    count: ({ where }: any = {}) =>
      Promise.resolve(rows.filter((r) => matches(r, where)).length),
    create: ({ data }: any) => {
      const row = { id: randomUUID(), ...defaults(), ...data };
      for (const u of uniques) {
        if (row[u] != null && rows.some((r) => r[u] === row[u])) {
          return Promise.reject(new Error(`Unique constraint: ${u}`));
        }
      }
      rows.push(row);
      return Promise.resolve(row);
    },
    update: ({ where, data }: any) => {
      const row = find(where);
      if (!row) return Promise.reject(new Error('not found'));
      Object.assign(row, data);
      return Promise.resolve(row);
    },
    updateMany: ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return Promise.resolve({ count: hit.length });
    },
    deleteMany: ({ where }: any = {}) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
      return Promise.resolve({ count: hit.length });
    },
  };
}

/** BD en memoria mínima para tests de auth/conexión (sin Postgres). */
export function fakePrisma() {
  return {
    user: table(
      () => ({ createdAt: new Date(), passwordChangedAt: new Date() }),
      ['email'],
    ),
    refreshToken: table(
      () => ({ revokedAt: null, replacedBy: null }),
      ['tokenHash'],
    ),
    mailAccount: table(
      () => ({ userId: null, tokenEnc: null, lastSyncAt: null }),
      ['email'],
    ),
    mailFolderSync: table(),
    thread: table(),
    message: table(),
    attachment: table(),
    ocrPage: table(),
    ocrRegion: table(),
    synthesis: table(),
    template: table(() => ({ kind: 'resumen', isActive: true, version: 1 })),
    setting: table(() => ({}), ['key']),
    report: table(() => ({ status: 'generando', createdAt: new Date() })),
    reportRow: table(() => ({ createdAt: new Date() })),
    threadReportData: table(),
    hospitalEvent: table(),
  };
}
