// Copia build-resources/* a <appOutDir>/resources (fuera de cualquier asar), conservando enlaces simbolicos.
const { cpSync, existsSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  const from = join(__dirname, '..', 'build-resources');
  if (!existsSync(join(from, 'api', 'node_modules'))) {
    throw new Error('Faltan los recursos: ejecuta `pnpm --filter desktop prepare:resources` antes de empaquetar.');
  }
  const to = join(context.appOutDir, 'resources');
  cpSync(from, to, { recursive: true, verbatimSymlinks: true });
};
