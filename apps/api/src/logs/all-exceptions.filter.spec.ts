import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
  type ArgumentsHost,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function hostFor() {
  const req = {
    method: 'POST',
    path: '/api/threads/1/analyze',
    url: '/api/threads/1/analyze?secreto=1',
    body: { password: 'nunca' },
    headers: { cookie: 'am_access=xyz' },
  };
  return {
    getType: () => 'http',
    getArgByIndex: () => ({}),
    getArgs: () => [req, {}],
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  let errorSpy: jest.SpyInstance;
  let filter: AllExceptionsFilter;
  let reply: jest.Mock;

  beforeEach(() => {
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    reply = jest.fn();
    filter = new AllExceptionsFilter({
      reply,
      isHeadersSent: () => false,
      end: jest.fn(),
    } as never);
  });

  afterEach(() => errorSpy.mockRestore());

  it('registra 5xx sin query, cuerpo ni cookies y responde 500 genérico', () => {
    filter.catch(new Error('fallo interno'), hostFor());
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [msg] = errorSpy.mock.calls[0] as [string];
    expect(msg).toBe('POST /api/threads/1/analyze -> 500 Error: fallo interno');
    const all = JSON.stringify(errorSpy.mock.calls);
    expect(all).not.toMatch(/secreto|nunca|am_access/);
    expect(reply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ statusCode: 500 }),
      500,
    );
  });

  it('registra HttpException 5xx', () => {
    filter.catch(new ServiceUnavailableException('sin OCR'), hostFor());
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0][2]).toBe(503);
  });

  it('no registra 4xx', () => {
    filter.catch(new BadRequestException('mal'), hostFor());
    expect(errorSpy).not.toHaveBeenCalled();
    expect(reply.mock.calls[0][2]).toBe(400);
  });
});
