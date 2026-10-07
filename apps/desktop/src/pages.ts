/** Pantallas estáticas (carga y error) en español sencillo. Sin scripts: los botones son enlaces. */
export const ACTION_RETRY = 'automed://reintentar';
export const ACTION_OPEN_DATA = 'automed://abrir-datos';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#1c2733;--card:#fff;--accent:#1f6feb;--muted:#5b6770}
@media (prefers-color-scheme:dark){:root{--bg:#10151b;--fg:#e8edf2;--card:#1a222b;--muted:#9aa7b2}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{background:var(--card);border-radius:16px;padding:32px;max-width:480px;width:calc(100% - 32px);box-shadow:0 4px 24px #0002}
h1{font-size:1.4rem;margin:0 0 8px}p{margin:8px 0;color:var(--muted)}
.warn{background:#fff4d6;color:#5c4300;padding:10px 12px;border-radius:10px;font-size:.9rem}
.btns{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}
a.btn{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:10px;text-decoration:none;font-weight:600;border:1px solid var(--accent);color:var(--accent)}
a.btn.primary{background:var(--accent);color:#fff}
.spin{width:28px;height:28px;border:4px solid #8884;border-top-color:var(--accent);border-radius:50%;animation:s 1s linear infinite;margin-bottom:12px}
@keyframes s{to{transform:rotate(360deg)}}`;

function doc(body: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>auto-med</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

export function loadingPage(step: string, warning?: string): string {
  return doc(
    `<div class="spin" role="status" aria-label="Cargando"></div><h1>Abriendo auto-med</h1><p>${esc(step)}</p>${
      warning ? `<p class="warn">${esc(warning)}</p>` : ''
    }`,
  );
}

export function errorPage(message: string, warning?: string): string {
  return doc(
    `<h1>No se pudo abrir auto-med</h1><p>${esc(message)}</p>${
      warning ? `<p class="warn">${esc(warning)}</p>` : ''
    }<div class="btns"><a class="btn primary" href="${ACTION_RETRY}">Reintentar</a><a class="btn" href="${ACTION_OPEN_DATA}">Abrir carpeta de datos</a></div>`,
  );
}

export const toDataUrl = (html: string) => 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
