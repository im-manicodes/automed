import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SessionGuard } from '../auth/session.guard';
import { UsageController } from './usage.controller';

describe('UsageController', () => {
  const usage = {
    summary: jest.fn().mockResolvedValue({ ok: 1 }),
    forecast: jest.fn().mockResolvedValue({ ok: 2 }),
    getPrices: jest.fn().mockResolvedValue({ ok: 3 }),
    savePrices: jest.fn().mockResolvedValue({ ok: 4 }),
  };
  const controller = new UsageController(usage as never);

  it('exige sesión (SessionGuard)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, UsageController)).toEqual([
      SessionGuard,
    ]);
  });

  it('delega en UsageService', async () => {
    expect(await controller.summary('hoy')).toEqual({ ok: 1 });
    expect(usage.summary).toHaveBeenCalledWith('hoy');
    expect(await controller.forecast('7')).toEqual({ ok: 2 });
    expect(usage.forecast).toHaveBeenCalledWith('7');
    expect(await controller.getPrices()).toEqual({ ok: 3 });
    const body = { modelos: {} };
    expect(await controller.savePrices(body)).toEqual({ ok: 4 });
    expect(usage.savePrices).toHaveBeenCalledWith(body);
  });
});
