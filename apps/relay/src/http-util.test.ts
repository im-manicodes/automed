import { describe, expect, it } from 'vitest';
import { deviceManifest, matchDevicePath, rewriteSetCookie } from './http-util';

describe('rewriteSetCookie', () => {
  const base = '/d/abc';
  it('reubica Path, quita Domain y fuerza Secure', () => {
    expect(rewriteSetCookie('am_access=t; Path=/; HttpOnly; SameSite=Lax; Domain=x.com', base, true)).toBe(
      'am_access=t; Path=/d/abc/; HttpOnly; SameSite=Lax; Secure',
    );
    expect(rewriteSetCookie('am_refresh=r; Path=/api/auth; HttpOnly; Secure', base, true)).toBe(
      'am_refresh=r; Path=/d/abc/api/auth; HttpOnly; Secure',
    );
  });
  it('sin Path lo acota; sin secure no lo añade', () => {
    expect(rewriteSetCookie('a=b', base, false)).toBe('a=b; Path=/d/abc/');
  });
});

describe('matchDevicePath', () => {
  it('separa deviceId y resto', () => {
    expect(matchDevicePath('/d/abc')).toEqual({ deviceId: 'abc', rest: '/' });
    expect(matchDevicePath('/d/abc/api/x?y=1')).toEqual({ deviceId: 'abc', rest: '/api/x' });
    expect(matchDevicePath('/x/abc')).toBeNull();
    expect(matchDevicePath('/d/a%b/x')).toBeNull();
  });
});

describe('PWA por dispositivo', () => {
  it('el manifest apunta a /d/<id>', () => {
    const m = JSON.parse(deviceManifest('{"start_url":"/tickets","scope":"/"}', '/d/abc'));
    expect(m).toMatchObject({ start_url: '/d/abc/tickets', scope: '/d/abc/' });
  });
});
