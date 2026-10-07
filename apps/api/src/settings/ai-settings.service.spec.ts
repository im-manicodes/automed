import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { TokenCryptoService } from '../auth/token-crypto.service';
import { AiSettingsService } from './ai-settings.service';

const KEY = randomBytes(32).toString('base64');

function setup(env: Record<string, string> = {}) {
  const rows = new Map<string, unknown>();
  const prisma: any = {
    setting: {
      findMany: jest.fn(() =>
        Promise.resolve([...rows].map(([key, value]) => ({ key, value }))),
      ),
      upsert: jest.fn(({ where, create }: any) => {
        rows.set(where.key, create.value);
        return Promise.resolve({});
      }),
    },
  };
  const all = { TOKEN_ENC_KEY: KEY, ...env } as Record<string, string>;
  const config: any = { get: (k: string) => all[k] };
  const crypto = new TokenCryptoService(config);
  return { svc: new AiSettingsService(prisma, config, crypto), prisma, rows };
}

describe('AiSettingsService', () => {
  it('sin datos en BD usa el .env (origen servidor) y pide bienvenida', async () => {
    const { svc } = setup({
      LLM_PROVIDER: 'openai',
      LLM_MODEL_TEXT: 'gpt-x',
      OPENAI_API_KEY: 'sk-env',
      SYNTH_MAX_INPUT_TOKENS: '30000',
    });
    const e = await svc.getEffective();
    expect(e.proveedor).toBe('openai');
    expect(e.modelos.resumen).toBe('gpt-x');
    expect(e.modelos.vision).toBe('gpt-x');
    expect(e.maxInputTokens).toBe(30000);
    expect(e.llm.openaiApiKey).toBe('sk-env');
    expect(e.origen).toBe('servidor');
    expect((await svc.getPublic()).necesitaBienvenida).toBe(true);
  });

  it('la BD (panel) tiene precedencia sobre el .env', async () => {
    const { svc } = setup({
      LLM_PROVIDER: 'openai',
      LLM_MODEL_TEXT: 'gpt-x',
      OPENAI_API_KEY: 'sk-env',
    });
    await svc.save({
      proveedor: 'openai',
      modelos: { resumen: 'gpt-panel', vision: 'gpt-vis' },
      maxInputTokens: 5000,
      claveOpenai: 'sk-panel',
    });
    const e = await svc.getEffective();
    expect(e.origen).toBe('panel');
    expect(e.modelos).toMatchObject({
      resumen: 'gpt-panel',
      vision: 'gpt-vis',
      whatsapp: 'gpt-x',
    });
    expect(e.maxInputTokens).toBe(5000);
    expect(e.llm.openaiApiKey).toBe('sk-panel');
    expect(await svc.modelFor('vision')).toBe('gpt-vis');
  });

  it('cambiar de proveedor usa los modelos por defecto de ese proveedor y vision cae al de texto', async () => {
    const { svc } = setup({ LLM_PROVIDER: 'openai', LLM_MODEL_TEXT: 'gpt-x' });
    await svc.save({ proveedor: 'ollama' });
    const e = await svc.getEffective();
    expect(Object.values(e.modelos)).toEqual(
      Array(5).fill('qwen3-vl:4b-instruct'),
    );
    await svc.save({ modelos: { resumen: 'otro' } });
    const e2 = await svc.getEffective();
    expect(e2.modelos.vision).toBe('otro');
  });

  it('cifra las claves en reposo y las descifra al usarlas', async () => {
    const { svc, rows } = setup();
    await svc.save({ claveAnthropic: 'sk-ant-secreta' });
    const stored = JSON.stringify(rows.get('ia.config'));
    expect(stored).not.toContain('sk-ant-secreta');
    expect(stored).toContain('anthropicKeyEnc');
    expect((await svc.getEffective()).llm.anthropicApiKey).toBe(
      'sk-ant-secreta',
    );
    await svc.save({ claveAnthropic: null });
    expect((await svc.getEffective()).llm.anthropicApiKey).toBeUndefined();
    expect((rows.get('ia.config') as any).anthropicKeyEnc).toBeUndefined();
  });

  it('credenciales AWS: cifradas en reposo, descifradas solo por getAwsCredentials y nunca en getPublic', async () => {
    const { svc, rows } = setup();
    expect(await svc.getAwsCredentials()).toBeUndefined();
    await svc.save({
      claveAwsAccessKeyId: 'AKIAEJEMPLO12345',
      claveAwsSecreto: 'secreto-aws-muy-largo',
    });
    const stored = JSON.stringify(rows.get('ia.config'));
    expect(stored).not.toContain('AKIAEJEMPLO12345');
    expect(stored).not.toContain('secreto-aws-muy-largo');
    expect(stored).toContain('awsAccessKeyIdEnc');
    expect(await svc.getAwsCredentials()).toEqual({
      accessKeyId: 'AKIAEJEMPLO12345',
      secretAccessKey: 'secreto-aws-muy-largo',
    });
    const pub = await svc.getPublic();
    expect(pub.claves.aws).toBe(true);
    const json = JSON.stringify(pub);
    expect(json).not.toContain('AKIAEJEMPLO12345');
    expect(json).not.toContain('secreto-aws-muy-largo');
    // guardar otra cosa no toca las claves
    await svc.save({ awsRegion: 'eu-west-1' });
    expect((await svc.getAwsCredentials())?.accessKeyId).toBe(
      'AKIAEJEMPLO12345',
    );
    await svc.save({ claveAwsAccessKeyId: null, claveAwsSecreto: null });
    expect(await svc.getAwsCredentials()).toBeUndefined();
    expect((await svc.getPublic()).claves.aws).toBe(false);
    expect((rows.get('ia.config') as any).awsSecretEnc).toBeUndefined();
  });

  it('credenciales AWS: deben venir juntas y ser válidas (400 en español)', async () => {
    const { svc } = setup();
    const bad: any[] = [
      { claveAwsAccessKeyId: 'AKIA1' },
      { claveAwsSecreto: 'x' },
      { claveAwsAccessKeyId: 'AKIA1', claveAwsSecreto: null },
      { claveAwsAccessKeyId: null, claveAwsSecreto: 'x' },
      { claveAwsAccessKeyId: '', claveAwsSecreto: 'x' },
      { claveAwsAccessKeyId: 'A K', claveAwsSecreto: 'x' },
      { claveAwsAccessKeyId: 'A'.repeat(129), claveAwsSecreto: 'x' },
      { claveAwsAccessKeyId: 'AKIA1', claveAwsSecreto: '' },
      { claveAwsAccessKeyId: 'AKIA1', claveAwsSecreto: 'x'.repeat(501) },
      { claveAwsAccessKeyId: 5, claveAwsSecreto: 'x' },
    ];
    for (const b of bad) {
      await expect(svc.save(b)).rejects.toThrow(BadRequestException);
    }
    expect(await svc.getAwsCredentials()).toBeUndefined();
  });

  it('getPublic jamás contiene claves, solo si existen', async () => {
    const { svc } = setup({ ANTHROPIC_API_KEY: 'sk-env-ant' });
    await svc.save({ claveOpenai: 'sk-openai-panel' });
    const pub = await svc.getPublic();
    const json = JSON.stringify(pub);
    expect(json).not.toContain('sk-openai-panel');
    expect(json).not.toContain('sk-env-ant');
    expect(json).not.toMatch(/Enc|apiKey|ApiKey/i);
    expect(pub.claves).toEqual({
      openai: true,
      anthropic: true,
      aws: false,
    });
    expect(pub.sugeridos.ollama.texto[0]).toBe('qwen3-vl:4b-instruct');
    expect(pub.sugeridos.openai.vision.length).toBeGreaterThan(0);
  });

  it('valida la entrada con mensajes en español (400)', async () => {
    const { svc, prisma } = setup();
    const bad: any[] = [
      { proveedor: 'gemini' },
      { modelos: { resumen: '' } },
      { modelos: { resumen: 'x'.repeat(201) } },
      { modelos: { magia: 'x' } },
      { ollamaUrl: 'ftp://x' },
      { ollamaUrl: 'no es url' },
      { awsRegion: '  ' },
      { maxInputTokens: 1999 },
      { maxInputTokens: 5000.5 },
      { claveOpenai: '' },
      { bienvenidaCompletada: false },
    ];
    for (const b of bad) {
      await expect(svc.save(b)).rejects.toMatchObject({ status: 400 });
    }
    await expect(svc.save({ proveedor: 'x' as any })).rejects.toThrow(
      /Proveedor no válido/,
    );
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });

  it('acepta valores válidos', async () => {
    const { svc } = setup();
    const pub = await svc.save({
      ollamaUrl: 'http://host:11434/v1',
      awsRegion: 'eu-west-1',
      maxInputTokens: 2000,
    });
    expect(pub.ollamaUrl).toBe('http://host:11434/v1');
    expect(pub.awsRegion).toBe('eu-west-1');
    expect(pub.maxInputTokens).toBe(2000);
  });

  it('la caché se invalida al guardar y no relee la BD entre lecturas', async () => {
    const { svc, prisma } = setup();
    await svc.getEffective();
    await svc.getEffective();
    await svc.getPublic();
    expect(prisma.setting.findMany).toHaveBeenCalledTimes(1);
    await svc.save({ modelos: { resumen: 'nuevo' } });
    expect(await svc.modelFor('resumen')).toBe('nuevo');
    expect(prisma.setting.findMany).toHaveBeenCalledTimes(2);
  });

  it('necesitaBienvenida pasa a false con bienvenidaCompletada y no toca ia.config', async () => {
    const { svc, rows } = setup();
    expect(await svc.bienvenidaCompletada()).toBe(false);
    const pub = await svc.save({ bienvenidaCompletada: true });
    expect(pub.necesitaBienvenida).toBe(false);
    expect(pub.origen).toBe('servidor');
    expect(rows.get('ia.bienvenida')).toEqual({ completada: true });
    expect(rows.has('ia.config')).toBe(false);
  });

  it('una clave guardada ilegible (TOKEN_ENC_KEY distinta) se trata como sin clave', async () => {
    const a = setup();
    await a.svc.save({ claveOpenai: 'sk-x' });
    const b = setup({ TOKEN_ENC_KEY: randomBytes(32).toString('base64') });
    b.rows.set('ia.config', a.rows.get('ia.config'));
    expect((await b.svc.getEffective()).llm.openaiApiKey).toBeUndefined();
  });
});
