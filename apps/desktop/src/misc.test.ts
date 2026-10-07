import { createServer } from 'node:net';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApiEnv, buildDatabaseUrl } from './api-env';
import { cleanStalePostmasterPid, isStalePostmasterPid } from './postgres';
import { getFreePort } from './ports';
import { resolvePaths } from './paths';
import { errorPage } from './pages';
import { isLocalOrigin, isSafeExternalUrl } from './url-guard';

describe('ports', () => {
  it('devuelve un puerto libre que se puede usar', async () => {
    const p = await getFreePort();
    expect(p).toBeGreaterThan(1023);
    await new Promise<void>((res, rej) => {
      const s = createServer().once('error', rej);
      s.listen(p, '127.0.0.1', () => s.close(() => res()));
    });
  });
  it('dos peticiones seguidas no devuelven siempre lo mismo ocupado', async () => {
    const a = await getFreePort();
    const s = createServer();
    await new Promise<void>((r) => s.listen(a, '127.0.0.1', () => r()));
    const b = await getFreePort();
    expect(b).not.toBe(a);
    s.close();
  });
});

describe('buildApiEnv', () => {
  const paths = resolvePaths('/res', '/app');
  const env = buildApiEnv({
    paths,
    dataDir: '/data',
    port: 4321,
    databaseUrl: 'postgresql://u:p@127.0.0.1:5/db',
    secrets: { jwtSecret: 'j'.repeat(48), tokenEncKey: 'k', pgPassword: 'p' },
    buildConfig: { msClientId: 'abc' },
    baseEnv: { PATH: '/bin', SECRET_DEL_USUARIO: 'no', HOME: '/h' },
  });
  it('incluye lo necesario para la API', () => {
    expect(env).toMatchObject({
      PORT: '4321',
      DATA_DIR: '/data',
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:5/db',
      FRONTEND_BUILD_PATH: paths.webDir,
      MS_CLIENT_ID: 'abc',
      MS_TENANT_ID: 'common',
      OCR_LOCAL_APP_DIR: paths.ocrLocalDir,
      OCR_LOCAL_REQUIREMENTS: paths.ocrRequirements,
      PDF_TEXT_MODE: 'node',
    });
    expect(env.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(env.PADDLE_PDX_CACHE_HOME).toContain('models');
  });
  it('no hereda variables arbitrarias del entorno', () => {
    expect(env.SECRET_DEL_USUARIO).toBeUndefined();
    expect(env.PATH).toBe('/bin');
  });
  it('codifica la contraseña en la URL', () => {
    expect(buildDatabaseUrl('a/b+c', 5432, 'automed', 'automed')).toBe(
      'postgresql://automed:a%2Fb%2Bc@127.0.0.1:5432/automed',
    );
  });
});

describe('postmaster.pid obsoleto', () => {
  it('detecta PID inexistente o ilegible', () => {
    expect(isStalePostmasterPid('1234\n/data\n', () => false)).toBe(true);
    expect(isStalePostmasterPid('1234\n/data\n', () => true)).toBe(false);
    expect(isStalePostmasterPid('basura', () => true)).toBe(true);
    expect(isStalePostmasterPid('', () => true)).toBe(true);
  });
  it('borra el archivo solo si está obsoleto', () => {
    const dir = mkdtempSync(join(tmpdir(), 'automed-pg-'));
    const f = join(dir, 'postmaster.pid');
    writeFileSync(f, '99999\n');
    expect(cleanStalePostmasterPid(dir, () => true)).toBe(false);
    expect(existsSync(f)).toBe(true);
    expect(cleanStalePostmasterPid(dir, () => false)).toBe(true);
    expect(existsSync(f)).toBe(false);
    expect(cleanStalePostmasterPid(dir, () => false)).toBe(false);
  });
});

describe('validación de URLs', () => {
  it('solo http(s) se abre fuera', () => {
    expect(isSafeExternalUrl('https://example.com/x')).toBe(true);
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
    for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'automed://x', 'data:text/html,hi', 'no es url', ''])
      expect(isSafeExternalUrl(u)).toBe(false);
  });
  it('reconoce el origen local', () => {
    expect(isLocalOrigin('http://localhost:3000/ajustes', 'http://localhost:3000')).toBe(true);
    expect(isLocalOrigin('http://localhost:3001/', 'http://localhost:3000')).toBe(false);
    expect(isLocalOrigin('https://localhost:3000/', 'http://localhost:3000')).toBe(false);
    expect(isLocalOrigin('http://evil.com/', 'http://localhost:3000')).toBe(false);
  });
});

describe('páginas', () => {
  it('escapa el mensaje de error', () => {
    expect(errorPage('<script>x</script>')).not.toContain('<script>x');
  });
});

import { livePostmasterPid } from './postgres';
describe('livePostmasterPid', () => {
  it('devuelve el PID solo si está vivo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'automed-pg2-'));
    expect(livePostmasterPid(dir)).toBeNull();
    writeFileSync(join(dir, 'postmaster.pid'), '4242\n/data\n');
    expect(livePostmasterPid(dir, () => true)).toBe(4242);
    expect(livePostmasterPid(dir, () => false)).toBeNull();
  });
});
