import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  safeStorage,
  shell,
  utilityProcess,
} from 'electron';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiProcess, waitForHealth, type ForkFn } from './api-process';
import { buildApiEnv, type BuildConfig } from './api-env';
import { createLogger } from './log';
import { errorPage, loadingPage, toDataUrl } from './pages';
import { devResourcesDir, resolvePaths } from './paths';
import { PostgresManager } from './postgres';
import { getFreePort } from './ports';
import { loadOrCreateSecrets } from './secrets';
import { createMainWindow } from './window';

const SMOKE = process.argv.includes('--smoke-test');
const SMOKE_TIMEOUT_MS = 120_000;

// El nombre fija la carpeta de datos del usuario (~/.config/auto-med, %APPDATA%\auto-med): sin esto
// Electron usaría el `name` del package.json ("desktop").
app.setName('auto-med');

// Los datos de prueba/smoke se pueden redirigir; debe fijarse antes de `ready`.
if (process.env.AUTOMED_DATA_DIR) {
  mkdirSync(process.env.AUTOMED_DATA_DIR, { recursive: true });
  app.setPath('userData', process.env.AUTOMED_DATA_DIR);
}
const dataDir = app.getPath('userData');
const log = createLogger(dataDir, 'main');
const apiLog = createLogger(dataDir, 'api');

const resources = app.isPackaged ? process.resourcesPath : devResourcesDir(join(__dirname, '..'));
const paths = resolvePaths(resources, join(__dirname, '..'));

// embedded-postgres registra un gancho de salida que falla al llamar a `done` (sin consecuencias);
// se registra y se evita el ruido en consola.
process.on('unhandledRejection', (e) => log(`promesa rechazada: ${msg(e)}`));

let win: BrowserWindow | null = null;
let pg: PostgresManager | null = null;
let api: ApiProcess | null = null;
let origin: string | null = null;
let warning: string | undefined;
let quitting = false;
let starting = false;

const showPage = (html: string) => {
  if (!win || win.isDestroyed()) return;
  void win.loadURL(toDataUrl(html));
};
const step = (text: string) => {
  log(`paso: ${text}`);
  showPage(loadingPage(text, warning));
};

function readBuildConfig(): BuildConfig {
  try {
    return JSON.parse(readFileSync(paths.buildConfig, 'utf8')) as BuildConfig;
  } catch {
    return {};
  }
}

async function stopBackend() {
  origin = null;
  try {
    await api?.stop();
  } catch (e) {
    log(`error al cerrar la API: ${msg(e)}`);
  }
  api = null;
  try {
    await pg?.stop();
  } catch (e) {
    log(`error al cerrar Postgres: ${msg(e)}`);
  }
  pg = null;
}

function msg(e: unknown) {
  return e instanceof Error ? e.message : 'error desconocido';
}

/** Arranca todo: secretos -> Postgres -> migraciones -> API -> salud. Devuelve el origen local. */
async function startBackend(): Promise<{ origin: string; port: number; health: Record<string, unknown> }> {
  step('Preparando tus claves…');
  const loaded = loadOrCreateSecrets(dataDir, safeStorage);
  warning = loaded.warning;
  if (warning) log(`aviso: ${warning}`);

  step('Iniciando la base de datos…');
  pg = new PostgresManager({
    dataDir,
    password: loaded.secrets.pgPassword,
    log,
    onUnexpectedExit: () => void onBackendDown('La base de datos se detuvo inesperadamente.'),
  });
  await pg.start();

  step('Actualizando la base de datos…');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runMigrations } = require(paths.migrateRunner) as {
    runMigrations(o: { connectionString: string; migrationsDir: string }): Promise<{ applied: string[]; skipped: string[] }>;
  };
  const result = await runMigrations({
    connectionString: pg.databaseUrl,
    migrationsDir: paths.migrationsDir,
  });
  log(`migraciones: ${result.applied.length} aplicadas, ${result.skipped.length} ya estaban`);

  step('Iniciando la aplicación…');
  const port = await getFreePort();
  const env = buildApiEnv({
    paths,
    dataDir,
    port,
    databaseUrl: pg.databaseUrl,
    secrets: loaded.secrets,
    buildConfig: readBuildConfig(),
  });
  api = new ApiProcess({
    fork: ((entry, args, opts) => utilityProcess.fork(entry, args, opts)) as ForkFn,
    entry: paths.apiEntry,
    env,
    log,
    onLine: (l) => apiLog(l),
    onUnexpectedExit: (code) => void onBackendDown(`La aplicación se detuvo inesperadamente (código ${code}).`),
  });
  const readyPort = await api.start();
  const health = await waitForHealth(readyPort);
  origin = `http://localhost:${readyPort}`;
  return { origin, port: readyPort, health };
}

async function onBackendDown(message: string) {
  if (quitting) return;
  log(`caída: ${message}`);
  showPage(errorPage(message, warning));
  await stopBackend();
}

async function launch() {
  if (starting) return;
  starting = true;
  try {
    await stopBackend();
    const r = await startBackend();
    if (win && !win.isDestroyed()) await win.loadURL(r.origin);
    log(`listo en ${r.origin}`);
  } catch (e) {
    log(`error de arranque: ${msg(e)}`);
    showPage(errorPage(userMessage(e), warning));
    await stopBackend();
  } finally {
    starting = false;
  }
}

function userMessage(e: unknown): string {
  const m = msg(e);
  return m.length > 300 ? m.slice(0, 300) + '…' : m;
}

function buildMenu() {
  const t: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'auto-med',
      submenu: [
        {
          label: 'Recargar',
          accelerator: 'CmdOrCtrl+R',
          click: () => (origin && win ? win.webContents.reload() : void launch()),
        },
        { label: 'Abrir carpeta de datos', click: () => void shell.openPath(dataDir) },
        {
          label: 'Acerca de',
          click: () =>
            void dialog.showMessageBox({
              type: 'info',
              title: 'Acerca de auto-med',
              message: `auto-med ${app.getVersion()}`,
              detail: 'Tus datos se guardan solo en este equipo.',
              buttons: ['Cerrar'],
            }),
        },
        { type: 'separator' },
        { label: 'Salir', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    { label: 'Editar', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

async function runSmoke() {
  const t0 = Date.now();
  const timer = setTimeout(() => finish(false, 'tiempo agotado (120 s)'), SMOKE_TIMEOUT_MS);
  const finish = async (ok: boolean, detail: string) => {
    clearTimeout(timer);
    await stopBackend();
    console.log(`SMOKE_TEST ${ok ? 'OK' : 'FAIL'} ${detail} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    app.exit(ok ? 0 : 1);
  };
  try {
    const r = await startBackend();
    const h = r.health as { status?: string; db?: boolean; storage?: boolean };
    const ok = h.status === 'ok' && h.db === true && h.storage === true;
    await finish(ok, `port=${r.port} health=${JSON.stringify(h)}`);
  } catch (e) {
    await finish(false, msg(e));
  }
}

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on('before-quit', (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    void stopBackend().finally(() => app.exit(0));
  });
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => app.quit());
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(async () => {
    if (!existsSync(paths.apiEntry)) {
      log(`faltan recursos en ${resources}`);
    }
    if (SMOKE) return runSmoke();
    buildMenu();
    win = createMainWindow({
      getOrigin: () => origin,
      onRetry: () => void launch(),
      onOpenData: () => void shell.openPath(dataDir),
    });
    win.on('closed', () => (win = null));
    showPage(loadingPage('Un momento…'));
    void launch();
  });
}
