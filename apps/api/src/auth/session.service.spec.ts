import { ConfigService } from '@nestjs/config';
import { SessionService } from './session.service';

const svc = (secret = 'abc') =>
  new SessionService({
    get: (k: string) => (k === 'SESSION_SECRET' ? secret : undefined),
  } as unknown as ConfigService);

describe('SessionService', () => {
  it('firma y verifica la cookie', () => {
    const s = svc();
    expect(s.verify(s.create('a@b.com'))?.email).toBe('a@b.com');
  });

  it('rechaza cookie alterada, de otra clave o expirada', () => {
    const s = svc();
    const t = s.create('a@b.com');
    expect(s.verify(t.replace(/^./, 'X'))).toBeNull();
    expect(svc('otra').verify(t)).toBeNull();
    expect(s.verify(t, Date.now() + 8 * 24 * 3600 * 1000)).toBeNull();
    expect(s.verify(undefined)).toBeNull();
  });

  it('state PKCE es de un solo uso', () => {
    const s = svc();
    const st = s.savePending('ver');
    expect(s.takePending(st)).toBe('ver');
    expect(s.takePending(st)).toBeNull();
  });

  it('parsea cookies', () => {
    expect(svc().parseCookie('a=1; am_session=xyz; b=2')).toBe('xyz');
  });
});
