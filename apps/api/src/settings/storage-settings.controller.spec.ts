import { StorageSettingsController } from './storage-settings.controller';

describe('StorageSettingsController', () => {
  it('delega en el servicio', async () => {
    const svc: any = {
      getPublic: jest.fn().mockResolvedValue({}),
      save: jest.fn().mockResolvedValue({}),
      test: jest.fn().mockResolvedValue({ ok: true }),
    };
    const c = new StorageSettingsController(svc);
    await c.get();
    await c.save({ proveedor: 's3' });
    await c.test(undefined);
    expect(svc.save).toHaveBeenCalledWith({ proveedor: 's3' });
    expect(svc.test).toHaveBeenCalledWith(undefined);
  });
});
