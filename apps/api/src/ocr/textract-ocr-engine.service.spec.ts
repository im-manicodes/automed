import { TextractClient } from '@aws-sdk/client-textract';
import { TextractOcrEngineService } from './textract-ocr-engine.service';

const config: any = { get: () => undefined };

function setup() {
  const state: { region: string; creds?: any } = { region: 'us-east-1' };
  const ai: any = {
    getEffective: jest.fn(async () => ({ awsRegion: state.region })),
    getAwsCredentials: jest.fn(async () => state.creds),
  };
  const svc = new TextractOcrEngineService(config, ai);
  const send = jest
    .spyOn(TextractClient.prototype, 'send')
    .mockImplementation((async () => ({ Blocks: [] })) as any);
  const clients = () => send.mock.contexts as unknown as TextractClient[];
  return { svc, state, send, clients };
}

describe('TextractOcrEngineService (cliente AWS)', () => {
  afterEach(() => jest.restoreAllMocks());
  const img = new Uint8Array([1]);

  it('reutiliza el cliente mientras no cambian credenciales ni región', async () => {
    const { svc, clients } = setup();
    await svc.recognize(img, 1);
    await svc.recognize(img, 2);
    const [a, b] = clients();
    expect(a).toBe(b);
  });

  it('recrea el cliente al cambiar las credenciales y usa las explícitas', async () => {
    const { svc, state, clients } = setup();
    await svc.recognize(img, 1);
    state.creds = { accessKeyId: 'AKIA1', secretAccessKey: 's1' };
    await svc.recognize(img, 1);
    state.creds = { accessKeyId: 'AKIA1', secretAccessKey: 's2' };
    await svc.recognize(img, 1);
    await svc.recognize(img, 1);
    const [c0, c1, c2, c3] = clients();
    expect(c1).not.toBe(c0);
    expect(c2).not.toBe(c1);
    expect(c3).toBe(c2);
    expect(await c1.config.credentials()).toMatchObject({
      accessKeyId: 'AKIA1',
      secretAccessKey: 's1',
    });
    expect(await c2.config.credentials()).toMatchObject({
      secretAccessKey: 's2',
    });
  });

  it('recrea el cliente al cambiar la región', async () => {
    const { svc, state, clients } = setup();
    await svc.recognize(img, 1);
    state.region = 'eu-west-1';
    await svc.recognize(img, 1);
    const [a, b] = clients();
    expect(b).not.toBe(a);
    expect(await b.config.region()).toBe('eu-west-1');
  });
});
