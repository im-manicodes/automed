import { ollamaCandidates, parseDefaultGateway } from './ollama-candidates';

const ROUTE = `Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT
eth0\t00000000\t010011AC\t0003\t0\t0\t0\t00000000\t0\t0\t0
eth0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0
`;

describe('parseDefaultGateway', () => {
  it('convierte el gateway hex little-endian a IPv4', () => {
    expect(parseDefaultGateway(ROUTE)).toBe('172.17.0.1');
  });
  it('sin ruta por defecto o entrada vacía -> undefined', () => {
    expect(parseDefaultGateway('')).toBeUndefined();
    expect(
      parseDefaultGateway(
        'Iface\tDestination\tGateway\neth0\t000011AC\t00000000\n',
      ),
    ).toBeUndefined();
  });
});

describe('ollamaCandidates', () => {
  it('docker: host.docker.internal, gateway y localhost', () => {
    expect(ollamaCandidates({ docker: true, gateway: '172.17.0.1' })).toEqual([
      'http://host.docker.internal:11434/v1',
      'http://172.17.0.1:11434/v1',
      'http://localhost:11434/v1',
    ]);
  });
  it('docker sin gateway', () => {
    expect(ollamaCandidates({ docker: true })).toEqual([
      'http://host.docker.internal:11434/v1',
      'http://localhost:11434/v1',
    ]);
  });
  it('fuera de docker: solo localhost; respeta el puerto', () => {
    expect(ollamaCandidates({ docker: false, gateway: '1.2.3.4' })).toEqual([
      'http://localhost:11434/v1',
    ]);
    expect(ollamaCandidates({ docker: false, port: 9 })).toEqual([
      'http://localhost:9/v1',
    ]);
  });
});
