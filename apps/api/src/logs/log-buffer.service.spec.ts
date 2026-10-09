import { Test, TestingModule } from '@nestjs/testing';
import {
  LOG_BUFFER_CAPACITY,
  LOG_BUFFER_CAPACITY_TOKEN,
  LOG_MAX_MESSAGE,
  LogBufferService,
  sanitizeLogMessage,
} from './log-buffer.service';

describe('LogBufferService', () => {
  let service: LogBufferService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LogBufferService],
    }).compile();
    service = module.get<LogBufferService>(LogBufferService);
  });

  it('usa la capacidad por defecto y ids incrementales', () => {
    for (let i = 0; i < LOG_BUFFER_CAPACITY + 5; i++) {
      service.append('log', 'X', `m${i}`);
    }
    expect(service.size()).toBe(LOG_BUFFER_CAPACITY);
    const { entries, ultimoId } = service.query({ limit: 10_000 });
    expect(entries[0].id).toBe(6);
    expect(entries[0].mensaje).toBe('m5');
    expect(ultimoId).toBe(LOG_BUFFER_CAPACITY + 5);
  });

  it('es circular con capacidad configurable', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        LogBufferService,
        { provide: LOG_BUFFER_CAPACITY_TOKEN, useValue: 3 },
      ],
    }).compile();
    const small = mod.get(LogBufferService);
    ['a', 'b', 'c', 'd', 'e'].forEach((m) => small.append('log', 'C', m));
    expect(small.query().entries.map((e) => e.mensaje)).toEqual([
      'c',
      'd',
      'e',
    ]);
  });

  it('filtra por nivel mínimo, desde, texto y límite', () => {
    service.append('error', 'Mail', 'falló sync');
    service.append('warn', 'Jobs', 'reintento');
    service.append('log', 'Jobs', 'ok');
    service.append('debug', 'Ocr', 'detalle');
    expect(
      service.query({ nivel: 'warn' }).entries.map((e) => e.nivel),
    ).toEqual(['error', 'warn']);
    expect(service.query({ desde: 2 }).entries.map((e) => e.id)).toEqual([
      3, 4,
    ]);
    expect(service.query({ q: 'JOBS' }).entries).toHaveLength(2);
    expect(service.query({ limit: 1 }).entries[0].mensaje).toBe('detalle');
  });

  it('clear vacía pero los ids siguen creciendo', () => {
    service.append('log', 'A', '1');
    service.clear();
    expect(service.size()).toBe(0);
    expect(service.append('log', 'A', '2').id).toBe(2);
    expect(service.query({ desde: 1 }).ultimoId).toBe(2);
  });

  it('tail devuelve las últimas líneas de un contexto y forContext etiqueta', () => {
    const inst = service.forContext('ocr-install');
    inst.log('paso 1');
    service.append('log', 'otro', 'x');
    inst.error('paso 2');
    expect(service.tail('ocr-install', 5).map((e) => e.mensaje)).toEqual([
      'paso 1',
      'paso 2',
    ]);
    expect(service.tail('ocr-install', 1)).toHaveLength(1);
  });

  it('toText genera texto plano', () => {
    service.append('warn', 'Ctx', 'hola');
    expect(service.toText()).toMatch(/WARN\s+\[Ctx\] hola$/);
  });

  it('sanea lo que guarda (Error y objetos incluidos)', () => {
    const e = service.append(
      'error',
      'Llm',
      new Error('401 con clave sk-abcdef1234567890 para ana@hospital.com'),
    );
    expect(e.mensaje).toBe(
      'Error: 401 con clave sk-[oculto] para [correo oculto]',
    );
    const o = service.append('log', 'X', { access_token: 'abc' });
    expect(o.mensaje).not.toContain('abc');
  });
});

describe('sanitizeLogMessage', () => {
  it('oculta Bearer, JWT, sk-, AWS, pares clave=valor y correos', () => {
    const jwt = 'eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl';
    const s = sanitizeLogMessage(
      `Authorization: Bearer abc.def-123 token=${jwt} key sk-ant-api03-XYZXYZXYZ AKIAABCDEFGHIJKLMNOP refresh_token=rt123 client_secret: "zzz" de juan.perez@correo.es`,
    );
    expect(s).not.toMatch(/abc\.def-123|eyJ|XYZXYZ|AKIAABCD|rt123|zzz|juan/);
    expect(s).toContain('[correo oculto]');
    expect(s).toContain('sk-[oculto]');
  });

  it('recorta mensajes largos', () => {
    const s = sanitizeLogMessage('a'.repeat(LOG_MAX_MESSAGE + 100));
    expect(s.length).toBeLessThan(LOG_MAX_MESSAGE + 20);
    expect(s).toMatch(/\[recortado\]$/);
  });

  it('no toca texto normal', () => {
    expect(sanitizeLogMessage('Sync terminado: 3 hilos')).toBe(
      'Sync terminado: 3 hilos',
    );
  });
});
