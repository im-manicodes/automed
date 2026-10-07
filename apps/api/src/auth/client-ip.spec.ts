import { clientIp } from './client-ip';

describe('clientIp', () => {
  const OLD = process.env.RELAY_IP_TOKEN;
  afterEach(() => {
    if (OLD === undefined) delete process.env.RELAY_IP_TOKEN;
    else process.env.RELAY_IP_TOKEN = OLD;
  });

  it('sin token configurado usa la IP del socket', () => {
    delete process.env.RELAY_IP_TOKEN;
    expect(
      clientIp({
        ip: '127.0.0.1',
        headers: {
          'x-automed-relay-ip': '1.2.3.4',
          'x-automed-relay-token': 'x',
        },
      }),
    ).toBe('127.0.0.1');
  });

  it('con token válido usa la IP real del celular', () => {
    process.env.RELAY_IP_TOKEN = 'secreto';
    expect(
      clientIp({
        ip: '127.0.0.1',
        headers: {
          'x-automed-relay-ip': '203.0.113.9',
          'x-automed-relay-token': 'secreto',
        },
      }),
    ).toBe('203.0.113.9');
    expect(
      clientIp({
        ip: '127.0.0.1',
        headers: {
          'x-automed-relay-ip': '2001:db8::1',
          'x-automed-relay-token': 'secreto',
        },
      }),
    ).toBe('2001:db8::1');
  });

  it('un cliente directo sin el token no puede falsear su IP', () => {
    process.env.RELAY_IP_TOKEN = 'secreto';
    expect(
      clientIp({
        ip: '127.0.0.1',
        headers: { 'x-automed-relay-ip': '9.9.9.9' },
      }),
    ).toBe('127.0.0.1');
    expect(
      clientIp({
        ip: '127.0.0.1',
        headers: {
          'x-automed-relay-ip': '9.9.9.9',
          'x-automed-relay-token': 'otro',
        },
      }),
    ).toBe('127.0.0.1');
  });

  it('ignora una IP con formato inválido', () => {
    process.env.RELAY_IP_TOKEN = 'secreto';
    expect(
      clientIp({
        ip: '127.0.0.1',
        headers: {
          'x-automed-relay-ip': 'no-es-ip',
          'x-automed-relay-token': 'secreto',
        },
      }),
    ).toBe('127.0.0.1');
  });
});
