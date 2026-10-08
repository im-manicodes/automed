import { DynamicStorageService } from './dynamic-storage.service';

const instances: any[] = [];
jest.mock('./s3-storage.service', () => ({
  S3StorageService: jest.fn().mockImplementation((cfg: any) => {
    const o = {
      cfg,
      ensureBucketWithRetry: jest.fn().mockResolvedValue(true),
      destroy: jest.fn(),
      isHealthy: jest.fn().mockResolvedValue(true),
      put: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
    };
    instances.push(o);
    return o;
  }),
}));

function setup(initial: any) {
  let cfg = initial;
  let listener = () => {};
  const settings: any = {
    getEffectiveS3Config: jest.fn(() => Promise.resolve(cfg)),
    onChange: (fn: () => void) => (listener = fn),
  };
  return {
    svc: new DynamicStorageService(settings),
    set: (c: any) => {
      cfg = c;
      listener();
    },
  };
}

const A = {
  endpoint: 'http://a:9000',
  region: 'r',
  bucket: 'aaa',
  forcePathStyle: true,
};
const B = { region: 'us-east-1', bucket: 'bbb', forcePathStyle: false };

describe('DynamicStorageService', () => {
  beforeEach(() => (instances.length = 0));

  it('sin configurar: no sano y las operaciones lanzan', async () => {
    const { svc } = setup(null);
    expect(await svc.isHealthy()).toBe(false);
    await expect(svc.put('k', Buffer.from('x'))).rejects.toThrow(
      'Almacenamiento sin configurar',
    );
  });

  it('reutiliza el cliente con la misma config y crea el bucket una vez', async () => {
    const { svc } = setup(A);
    await svc.put('k', Buffer.from('x'));
    await svc.exists('k');
    expect(instances).toHaveLength(1);
    expect(instances[0].ensureBucketWithRetry).toHaveBeenCalledTimes(1);
  });

  it('cambia de config en caliente', async () => {
    const { svc, set } = setup(A);
    await svc.put('k', Buffer.from('x'));
    set(B);
    await svc.put('k', Buffer.from('x'));
    expect(instances).toHaveLength(2);
    expect(instances[0].destroy).toHaveBeenCalled();
    expect(instances[1].cfg.bucket).toBe('bbb');
  });
});
