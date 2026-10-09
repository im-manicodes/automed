import { LogBufferService } from './log-buffer.service';
import { AppLogger } from './app-logger';

describe('AppLogger', () => {
  let buffer: LogBufferService;
  let logger: AppLogger;

  beforeEach(() => {
    buffer = new LogBufferService();
    logger = new AppLogger(buffer);
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => jest.restoreAllMocks());

  it('escribe en stdout y en el buffer con el contexto', () => {
    logger.log('Sync listo', 'MailSync');
    expect(process.stdout.write).toHaveBeenCalled();
    expect(buffer.query().entries[0]).toMatchObject({
      nivel: 'log',
      contexto: 'MailSync',
      mensaje: 'Sync listo',
    });
  });

  it('error guarda unas líneas de la pila y sanea', () => {
    const err = new Error('x');
    logger.error('fallo con Bearer abc123', err.stack, 'Jobs');
    const e = buffer.query().entries[0];
    expect(e).toMatchObject({ nivel: 'error', contexto: 'Jobs' });
    expect(e.mensaje).toContain('Bearer [oculto]');
    expect(e.mensaje).toContain(' | at ');
  });

  it('fatal se guarda como error; respeta niveles desactivados', () => {
    logger.fatal('caída', 'Main');
    expect(buffer.query().entries[0].nivel).toBe('error');
    logger.setLogLevels(['error']);
    logger.log('no', 'X');
    expect(buffer.size()).toBe(1);
  });
});
