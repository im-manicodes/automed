import { BadRequestException } from '@nestjs/common';
import { OcrSettingsService } from './ocr-settings.service';
import { DEFAULT_VISION_AMBITO } from '../templates/template-instructions';
import { fakePrisma } from '../../test/helpers/fake-prisma';

function make(env: Record<string, string> = {}) {
  const db = fakePrisma();
  const svc = new OcrSettingsService(
    db as never,
    { get: (k: string) => env[k] } as never,
    {
      encrypt: (v: string) => `enc:${v}`,
      decrypt: (v: string) => v.slice(4),
    } as never,
  );
  return { db, svc };
}

describe('OcrSettingsService', () => {
  it('por defecto: local y detect, origen servidor', async () => {
    const { svc } = make();
    expect(await svc.getEffective()).toEqual({
      motor: 'local',
      textractMode: 'detect',
      visionRetry: false,
      visionSegundoIntento: true,
      visionMaxRegions: 30,
      renderDpi: 250,
      visionAmbito: DEFAULT_VISION_AMBITO,
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

  it('relectura con IA, máximo de partes y DPI: panel > .env > defecto', async () => {
    const { svc } = make({
      OCR_VISION_RETRY: 'true',
      OCR_VISION_MAX_REGIONS: '50',
      OCR_RENDER_DPI: '300',
    });
    expect(await svc.getEffective()).toMatchObject({
      visionRetry: true,
      visionMaxRegions: 50,
      renderDpi: 300,
    });
    await svc.save({ visionRetry: false, visionMaxRegions: 7, renderDpi: 200 });
    expect(await svc.getEffective()).toMatchObject({
      visionRetry: false,
      visionMaxRegions: 7,
      renderDpi: 200,
      motor: 'local',
      origen: 'panel',
    });
  });

  it('segundo intento: defecto true y panel', async () => {
    const { svc } = make();
    expect((await svc.getEffective()).visionSegundoIntento).toBe(true);
    await svc.save({ visionSegundoIntento: false });
    expect((await svc.getEffective()).visionSegundoIntento).toBe(false);
    await svc.save({ visionSegundoIntento: true });
    expect((await svc.getEffective()).visionSegundoIntento).toBe(true);
  });

  it('rechaza valores fuera de rango con 400 en español', async () => {
    const { svc } = make();
    for (const bad of [
      { visionMaxRegions: 0 },
      { visionMaxRegions: 201 },
      { visionMaxRegions: 2.5 },
      { renderDpi: 149 },
      { renderDpi: 401 },
      { visionRetry: 'si' as never },
      { visionSegundoIntento: 'no' as never },
    ]) {
      await expect(svc.save(bad)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('azure: guarda el endpoint y la clave cifrada, sin exponerla', async () => {
    const { svc, db } = make();
    await svc.save({
      motor: 'azure',
      azureEndpoint: 'https://x.cognitiveservices.azure.com/',
      claveAzure: ' k-1 ',
    });
    expect(await svc.getEffective()).toMatchObject({ motor: 'azure' });
    expect(await svc.getAzurePublic()).toEqual({
      azureEndpoint: 'https://x.cognitiveservices.azure.com',
      claveAzure: true,
    });
    expect(await svc.getAzureCredentials()).toEqual({
      endpoint: 'https://x.cognitiveservices.azure.com',
      key: 'k-1',
    });
    expect(JSON.stringify(db)).not.toContain('"k-1"');
    await svc.save({ claveAzure: null });
    expect(await svc.getAzureCredentials()).toBeNull();
  });

  it('azure: valida endpoint y clave', async () => {
    const { svc } = make();
    await expect(svc.save({ azureEndpoint: 'no-url' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.save({ claveAzure: '  ' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('visionAmbito: por defecto, texto propio, vacío y null restablece; valida el máximo', async () => {
    const { svc } = make();
    await svc.save({ visionAmbito: 'Radiología' });
    expect((await svc.getEffective()).visionAmbito).toBe('Radiología');
    await svc.save({ visionAmbito: '' });
    expect((await svc.getEffective()).visionAmbito).toBe('');
    await svc.save({ visionAmbito: null });
    expect((await svc.getEffective()).visionAmbito).toBe(DEFAULT_VISION_AMBITO);
    await expect(svc.save({ visionAmbito: 'x'.repeat(2001) })).rejects.toThrow(
      BadRequestException,
    );
  });
});
