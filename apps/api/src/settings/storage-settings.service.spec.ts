import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { TokenCryptoService } from '../auth/token-crypto.service';
import {
  StorageSettingsService,
  explainStorageError,
} from './storage-settings.service';

const probe = jest.fn();
jest.mock('../storage/s3-storage.service', () => ({
  S3StorageService: jest.fn().mockImplementation(() => ({
    probe: (...a: unknown[]) => probe(...a),
    destroy: jest.fn(),
  })),
}));

const KEY = randomBytes(32).toString('base64');

function setup(env: Record<string, string> = {}) {
  const rows = new Map<string, any>();
  const prisma: any = {
    setting: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          rows.has(where.key)
            ? { key: where.key, value: rows.get(where.key) }
            : null,
        ),
      ),
      upsert: jest.fn(({ where, create }: any) => {
        rows.set(where.key, create.value);
        return Promise.resolve({});
      }),
    },
  };
  const all = { TOKEN_ENC_KEY: KEY, ...env } as Record<string, string>;
  const config: any = { get: (k: string) => all[k] };
  const svc = new StorageSettingsService(
    prisma,
    config,
    new TokenCryptoService(config),
  );
  return { svc, rows };
}

const RUSTFS = {
  proveedor: 'rustfs',
  rustfs: {
    endpoint: 'http://rustfs:9000/',
    bucket: 'automed',
    accessKey: 'ak',
    secretKey: 'SECRETO',
  },
};

describe('StorageSettingsService', () => {
  beforeEach(() => probe.mockReset());

  it('sin nada: no configurado', async () => {
    const { svc } = setup();
    expect(await svc.getPublic()).toMatchObject({
      configurado: false,
      origen: 'ninguno',
      proveedor: null,
    });
    expect(await svc.getEffectiveS3Config()).toBeNull();
  });

  it('usa S3_* del .env como rustfs', async () => {
    const { svc } = setup({
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'b-env',
      S3_ACCESS_KEY: 'a',
      S3_SECRET_KEY: 's',
    });
    const p = await svc.getPublic();
    expect(p).toMatchObject({
      configurado: true,
      origen: 'env',
      proveedor: 'rustfs',
    });
    expect(p.rustfs).toEqual({
      endpoint: 'http://localhost:9000',
      bucket: 'b-env',
      accessKey: 'a',
      tieneSecreto: true,
    });
    expect(await svc.getEffectiveS3Config()).toMatchObject({
      forcePathStyle: true,
      secretAccessKey: 's',
    });
  });

  it('guarda cifrado, panel gana sobre env y el secreto no se devuelve', async () => {
    const { svc, rows } = setup({
      S3_ENDPOINT: 'http://env:9000',
      S3_SECRET_KEY: 'envsec',
    });
    const p = await svc.save(RUSTFS);
    expect(JSON.stringify(p)).not.toContain('SECRETO');
    expect(JSON.stringify(rows.get('storage.config'))).not.toContain('SECRETO');
    expect(p).toMatchObject({
      origen: 'panel',
      proveedor: 'rustfs',
      configurado: true,
    });
    expect(p.rustfs.endpoint).toBe('http://rustfs:9000');
    expect((await svc.getEffectiveS3Config())?.secretAccessKey).toBe('SECRETO');
  });

  it('secreto omitido conserva el guardado', async () => {
    const { svc } = setup();
    await svc.save(RUSTFS);
    await svc.save({
      proveedor: 'rustfs',
      rustfs: {
        endpoint: 'http://otro:9000',
        bucket: 'automed',
        accessKey: 'ak',
        secretKey: '',
      },
    });
    const cfg = await svc.getEffectiveS3Config();
    expect(cfg).toMatchObject({
      endpoint: 'http://otro:9000',
      secretAccessKey: 'SECRETO',
    });
  });

  it('s3 sin claves usa la cadena por defecto del SDK', async () => {
    const { svc } = setup();
    const p = await svc.save({
      proveedor: 's3',
      s3: { region: 'us-east-2', bucket: 'mi-bucket' },
    });
    expect(p.s3).toMatchObject({ region: 'us-east-2', tieneSecreto: false });
    const cfg = await svc.getEffectiveS3Config();
    expect(cfg?.accessKeyId).toBeUndefined();
    expect(cfg?.forcePathStyle).toBe(false);
  });

  it('valida entradas', async () => {
    const { svc } = setup();
    await expect(svc.save({ proveedor: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      svc.save({
        ...RUSTFS,
        rustfs: { ...RUSTFS.rustfs, endpoint: 'ftp://x' },
      }),
    ).rejects.toThrow(/http/);
    await expect(
      svc.save({ ...RUSTFS, rustfs: { ...RUSTFS.rustfs, bucket: 'AB' } }),
    ).rejects.toThrow(/bucket/);
    await expect(
      svc.save({ proveedor: 's3', s3: { bucket: 'abc' } }),
    ).rejects.toThrow(/región/);
    await expect(
      svc.save({
        proveedor: 's3',
        s3: { region: 'r', bucket: 'abc', accessKeyId: 'x' },
      }),
    ).rejects.toThrow(/juntas/);
  });

  it('avisa a los oyentes al guardar', async () => {
    const { svc } = setup();
    const fn = jest.fn();
    svc.onChange(fn);
    await svc.save(RUSTFS);
    expect(fn).toHaveBeenCalled();
  });

  it('test: sin config, ok y error traducido', async () => {
    const { svc } = setup();
    expect(await svc.test()).toEqual({
      ok: false,
      mensaje: 'Almacenamiento sin configurar',
    });
    probe.mockResolvedValueOnce(undefined);
    expect((await svc.test(RUSTFS)).ok).toBe(true);
    probe.mockRejectedValueOnce(
      Object.assign(new Error('x'), { name: 'InvalidAccessKeyId' }),
    );
    const r = await svc.test(RUSTFS);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/credenciales/);
    expect(r.mensaje).not.toContain('SECRETO');
  });

  it('explainStorageError', () => {
    expect(explainStorageError({ code: 'ECONNREFUSED' })).toMatch(/conectar/);
    expect(explainStorageError({ $metadata: { httpStatusCode: 403 } })).toMatch(
      /permiso/,
    );
    expect(explainStorageError({ name: 'BucketAlreadyExists' })).toMatch(
      /otra cuenta/,
    );
  });
});
