import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ReportsService } from './reports.service';

function setup(settings: Record<string, unknown> = {}) {
  const reports: any[] = [];
  const settingRows = new Map<string, unknown>(Object.entries(settings));
  const prisma: any = {
    report: {
      findFirst: ({ where = {} }: any = {}) =>
        Promise.resolve(
          [...reports]
            .reverse()
            .find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ??
            null,
        ),
      findUnique: ({ where }: any) =>
        Promise.resolve(reports.find((r) => r.id === where.id) ?? null),
      findMany: () => Promise.resolve([...reports].reverse()),
      create: ({ data }: any) => {
        const r = {
          id: `r${reports.length + 1}`,
          storageKey: null,
          fileName: null,
          templateVersion: null,
          error: null,
          finishedAt: null,
          totalHospitalizados: 0,
          totalConNovedad: 0,
          totalAltas: 0,
          procesados: 0,
          total: 0,
          columnas: [],
          createdAt: new Date(),
          ...data,
        };
        reports.push(r);
        return Promise.resolve(r);
      },
      updateMany: ({ where, data }: any) => {
        const hit = reports.filter(
          (r) => r.id === where.id && r.status === where.status,
        );
        hit.forEach((r) => Object.assign(r, data));
        return Promise.resolve({ count: hit.length });
      },
    },
    reportRow: { findMany: jest.fn().mockResolvedValue([]) },
    setting: {
      findUnique: ({ where }: any) =>
        Promise.resolve(
          settingRows.has(where.key)
            ? { value: settingRows.get(where.key) }
            : null,
        ),
      upsert: ({ where, create }: any) => {
        settingRows.set(where.key, create.value);
        return Promise.resolve({});
      },
    },
  };
  const storage: any = { get: jest.fn() };
  const queue: any = { enqueue: jest.fn().mockResolvedValue('job1') };
  const handlers = new Map<string, any>();
  const periodic: any[] = [];
  const worker: any = {
    register: (t: string, h: any) => handlers.set(t, h),
    addPeriodic: (f: any) => periodic.push(f),
  };
  const generator: any = {
    generate: jest.fn(),
  };
  const svc = new ReportsService(prisma, storage, queue, worker, generator);
  svc.onModuleInit();
  return {
    svc,
    reports,
    prisma,
    storage,
    queue,
    handlers,
    periodic,
    generator,
    settingRows,
  };
}

describe('ReportsService', () => {
  it('registra el handler generate_report y la tarea periódica', async () => {
    const h = setup();
    expect(h.handlers.has('generate_report')).toBe(true);
    expect(h.periodic).toHaveLength(1);
    await h.handlers
      .get('generate_report')
      .handle({ payload: { reportId: 'r1' } });
    expect(h.generator.generate).toHaveBeenCalledWith('r1');
  });

  it('createManual encola con dedupeKey y reutiliza el reporte en curso', async () => {
    const h = setup();
    const a = await h.svc.createManual();
    expect(a.reutilizado).toBe(false);
    expect(h.queue.enqueue).toHaveBeenCalledWith(
      'generate_report',
      { reportId: a.reporte.id },
      { dedupeKey: `generate_report:${a.reporte.id}` },
      expect.any(Date),
    );
    const b = await h.svc.createManual();
    expect(b.reutilizado).toBe(true);
    expect(b.reporte.id).toBe(a.reporte.id);
    expect(h.queue.enqueue).toHaveBeenCalledTimes(1);
    // terminado => se puede crear otro
    h.reports[0].status = 'listo';
    const c = await h.svc.createManual();
    expect(c.reporte.id).not.toBe(a.reporte.id);
  });

  it('programación: respeta activación, hora local y es idempotente por día', async () => {
    const h = setup({
      'reporte.programado': true,
      'reporte.hora': '07:00',
      'reporte.zona': 'America/Mexico_City',
    });
    expect(await h.svc.checkSchedule(new Date('2026-10-06T12:59:00Z'))).toBe(
      false,
    ); // 06:59 local
    expect(await h.svc.checkSchedule(new Date('2026-10-06T13:00:00Z'))).toBe(
      true,
    );
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]).toMatchObject({
      trigger: 'programado',
      fecha: '2026-10-06',
    });
    h.reports[0].status = 'listo';
    expect(await h.svc.checkSchedule(new Date('2026-10-06T13:01:00Z'))).toBe(
      false,
    );
    expect(await h.svc.checkSchedule(new Date('2026-10-06T20:00:00Z'))).toBe(
      false,
    );
    expect(h.reports).toHaveLength(1);
    expect(h.queue.enqueue).toHaveBeenCalledTimes(1);
    // día siguiente: uno nuevo
    expect(await h.svc.checkSchedule(new Date('2026-10-07T13:00:00Z'))).toBe(
      true,
    );
    expect(h.reports).toHaveLength(2);
  });

  it('programación desactivada (por defecto) no crea nada; un reporte manual del día no cuenta', async () => {
    const off = setup();
    expect(await off.svc.checkSchedule(new Date('2026-10-06T20:00:00Z'))).toBe(
      false,
    );
    const on = setup({ 'reporte.programado': true, 'reporte.hora': '07:00' });
    await on.svc.createManual();
    on.reports[0].status = 'listo';
    expect(await on.svc.checkSchedule(new Date('2026-10-06T20:00:00Z'))).toBe(
      true,
    );
  });

  it('programación no se solapa con un reporte generándose', async () => {
    const h = setup({ 'reporte.programado': true, 'reporte.hora': '07:00' });
    await h.svc.createManual();
    expect(await h.svc.checkSchedule(new Date('2026-10-06T20:00:00Z'))).toBe(
      false,
    );
  });

  it('ajustes: defaults, guardado parcial y validación', async () => {
    const h = setup();
    expect(await h.svc.getSettings()).toEqual({
      programado: false,
      hora: '07:00',
      zona: 'America/Mexico_City',
    });
    expect(
      await h.svc.updateSettings({ programado: true, hora: '18:30' }),
    ).toEqual({ programado: true, hora: '18:30', zona: 'America/Mexico_City' });
    await expect(
      h.svc.updateSettings({ hora: '25:00' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.svc.updateSettings({ zona: 'No/Existe' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.svc.updateSettings({ programado: 'si' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('download: 404 si no existe, 409 si no está listo, stream con tipo y nombre si está listo', async () => {
    const h = setup();
    await expect(h.svc.download('nada')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const { reporte } = await h.svc.createManual();
    await expect(h.svc.download(reporte.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    Object.assign(h.reports[0], {
      status: 'listo',
      storageKey: 'reportes/x.xlsx',
      fileName: 'reporte_2026-10-06_0700.xlsx',
    });
    h.storage.get.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const f = await h.svc.download(reporte.id);
    const headers = f.getHeaders();
    expect(headers.type).toContain('spreadsheetml.sheet');
    expect(headers.disposition).toContain(
      'attachment; filename="reporte_2026-10-06_0700.xlsx"',
    );
    h.storage.get.mockRejectedValue(new Error('NoSuchKey'));
    await expect(h.svc.download(reporte.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('onFailed marca el reporte en error sin contenido', async () => {
    const h = setup();
    const { reporte } = await h.svc.createManual();
    await h.handlers
      .get('generate_report')
      .onFailed(
        { payload: { reportId: reporte.id } },
        new Error('RustFS caído'),
      );
    expect(h.reports[0]).toMatchObject({
      status: 'error',
      error: 'RustFS caído',
    });
  });

  it('detail: 404 y filas con novedad sin storageKey en el DTO', async () => {
    const h = setup();
    await expect(h.svc.detail('x')).rejects.toBeInstanceOf(NotFoundException);
    const { reporte } = await h.svc.createManual();
    const d = await h.svc.detail(reporte.id);
    expect(d).not.toHaveProperty('storageKey');
    expect(d.filasConNovedad).toEqual([]);
  });
});
