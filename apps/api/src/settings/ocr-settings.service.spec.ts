import { BadRequestException } from '@nestjs/common';
import { OcrSettingsService } from './ocr-settings.service';
import { fakePrisma } from '../../test/helpers/fake-prisma';

function make(env: Record<string, string> = {}) {
  const db = fakePrisma();
  const svc = new OcrSettingsService(
    db as never,
    { get: (k: string) => env[k] } as never,
  );
  return { db, svc };
}

describe('OcrSettingsService', () => {
  it('por defecto: local y detect, origen servidor', async () => {
    const { svc } = make();
    expect(await svc.getEffective()).toEqual({
      motor: 'local',
      textractMode: 'detect',
      origen: 'servidor',
    });
  });

  it('el .env aplica si no hay panel', async () => {
    const { svc } = make({ OCR_ENGINE: 'textract', TEXTRACT_MODE: 'analyze' });
    expect(await svc.getEffective()).toMatchObject({
      motor: 'textract',
      textractMode: 'analyze',
    });
  });

  it('el panel gana sobre el .env y acepta ninguno', async () => {
    const { svc } = make({ OCR_ENGINE: 'textract' });
    await svc.save({ motor: 'ninguno' });
    expect(await svc.getEffective()).toMatchObject({
      motor: 'ninguno',
      textractMode: 'detect',
      origen: 'panel',
    });
  });

  it('guardado parcial conserva lo anterior', async () => {
    const { svc } = make();
    await svc.save({ motor: 'textract' });
    await svc.save({ textractMode: 'analyze' });
    expect(await svc.getEffective()).toMatchObject({
      motor: 'textract',
      textractMode: 'analyze',
    });
  });

  it('valida con mensajes en español', async () => {
    const { svc } = make();
    await expect(svc.save({ motor: 'x' as never })).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.save({ motor: 'x' as never })).rejects.toThrow(
      /Motor de OCR no válido/,
    );
    await expect(svc.save({ textractMode: 'z' as never })).rejects.toThrow(
      /Modo de Textract/,
    );
    await expect(svc.save(null as never)).rejects.toThrow(/Datos no válidos/);
  });

  it('la caché se invalida al guardar y se reutiliza al leer', async () => {
    const { svc, db } = make();
    const spy = jest.spyOn(db.setting, 'findUnique');
    await svc.getEffective();
    await svc.getEffective();
    expect(spy).toHaveBeenCalledTimes(1);
    await svc.save({ motor: 'ninguno' });
    expect((await svc.getEffective()).motor).toBe('ninguno');
  });
});
