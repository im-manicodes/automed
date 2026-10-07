/**
 * Hash esperado del arranque que sirve el relay (apps/relay/bootstrap). Copia a mano de la salida de
 * `pnpm --filter relay bootstrap:hash`; `front.e2e.test.ts` comprueba que coincide con los archivos reales
 * y con lo publicado en docs/relay-e2e.md. Al cambiar el arranque: regenerar, copiar aquí y a la doc.
 */
export const BOOTSTRAP_SHA256 = {
  files: {
    'index.html': '98c08b1ea31b2017a5148623e1febe81be23244d701a5b2c1fa98e72e1e15eda',
    'boot.js': '1224b4cf82d15d23316621adc8396ca2bd9fcaa9d107f420658191b96f96f7ef',
    'sw.js': '5aff357c6c981268fa1d399cac3ff6b365ef1853a493dd8a9e8c2dc4ed1e7237',
  } as Record<string, string>,
  combined: 'ba7710c3b525faca9450a89ab183ab2af7a1c7ecb72291a6a07d607464ea06c7',
};
