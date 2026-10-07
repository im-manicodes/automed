import { BrowserWindow, shell } from 'electron';
import { ACTION_OPEN_DATA, ACTION_RETRY } from './pages';
import { isLocalOrigin, isSafeExternalUrl } from './url-guard';

export interface WindowHandlers {
  getOrigin(): string | null;
  onRetry(): void;
  onOpenData(): void;
}

export function createMainWindow(h: WindowHandlers): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 360,
    minHeight: 480,
    title: 'auto-med',
    backgroundColor: '#f6f7f9',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (url === ACTION_RETRY) {
      e.preventDefault();
      h.onRetry();
      return;
    }
    if (url === ACTION_OPEN_DATA) {
      e.preventDefault();
      h.onOpenData();
      return;
    }
    const origin = h.getOrigin();
    if (url.startsWith('data:text/html')) return; // pantallas propias
    if (origin && isLocalOrigin(url, origin)) return;
    e.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });
  return win;
}
