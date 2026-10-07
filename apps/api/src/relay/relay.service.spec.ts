import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RelayService } from './relay.service';

const cfg = (v: Record<string, string>) =>
  ({ get: (k: string) => v[k] }) as unknown as ConfigService;

describe('RelayService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sin control (no es escritorio): no disponible', async () => {
    const s = new RelayService(cfg({}));
    expect(await s.status()).toMatchObject({
      disponible: false,
      activo: false,
    });
  });

  it('reenvía al control con el token y marca disponible', async () => {
    const f = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          configurado: true,
          activo: true,
          estado: 'conectado',
          url: 'https://r/d/x',
        }),
      ),
    );
    const s = new RelayService(
      cfg({
        RELAY_CONTROL_URL: 'http://127.0.0.1:9',
        RELAY_CONTROL_TOKEN: 't',
      }),
    );
    const r = await s.enable();
    expect(r).toMatchObject({
      disponible: true,
      estado: 'conectado',
      url: 'https://r/d/x',
    });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:9/enable');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toEqual({
      Authorization: 'Bearer t',
    });
  });

  it('si el control no responde: 503 en español', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('x'));
    const s = new RelayService(
      cfg({
        RELAY_CONTROL_URL: 'http://127.0.0.1:9',
        RELAY_CONTROL_TOKEN: 't',
      }),
    );
    await expect(s.status()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('keep-awake reenvía el booleano y rechaza otros valores', async () => {
    const f = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ activo: true, mantenerDespierto: true })),
      );
    const s = new RelayService(
      cfg({
        RELAY_CONTROL_URL: 'http://127.0.0.1:9',
        RELAY_CONTROL_TOKEN: 't',
      }),
    );
    const r = await s.keepAwake(true);
    expect(r.mantenerDespierto).toBe(true);
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe('{"activo":true}');
    expect(f.mock.calls[0][0]).toBe('http://127.0.0.1:9/keep-awake');
    expect(() => s.keepAwake('si')).toThrow();
  });
});
