import { MicrosoftSettingsController } from './microsoft-settings.controller';

describe('MicrosoftSettingsController', () => {
  it('delega en el servicio', async () => {
    const svc: any = {
      getPublic: jest.fn().mockResolvedValue({ configurado: true }),
      save: jest.fn().mockResolvedValue({ configurado: true }),
    };
    const c = new MicrosoftSettingsController(svc);
    await c.get();
    await c.save({ tenantId: 'common' });
    expect(svc.getPublic).toHaveBeenCalled();
    expect(svc.save).toHaveBeenCalledWith({ tenantId: 'common' });
  });
});
