import { join } from 'node:path';

export interface AppPaths {
  /** Carpeta con api/, web/ y ocr-local/ (recursos empaquetados). */
  resources: string;
  apiDir: string;
  apiEntry: string;
  migrationsDir: string;
  migrateRunner: string;
  webDir: string;
  ocrLocalDir: string;
  ocrRequirements: string;
  buildConfig: string;
}

/**
 * Rutas de los recursos. Empaquetado: `process.resourcesPath` (extraResources, fuera del asar).
 * Desarrollo: `apps/desktop/build-resources` (lo genera `scripts/prepare-resources.mjs`).
 */
export function resolvePaths(resources: string, desktopRoot: string): AppPaths {
  const apiDir = join(resources, 'api');
  return {
    resources,
    apiDir,
    apiEntry: join(apiDir, 'dist', 'main-desktop.js'),
    migrationsDir: join(apiDir, 'prisma', 'migrations'),
    migrateRunner: join(apiDir, 'dist', 'db', 'migrate-runner.js'),
    webDir: join(resources, 'web'),
    ocrLocalDir: join(resources, 'ocr-local'),
    ocrRequirements: join(resources, 'ocr-local', 'requirements.txt'),
    buildConfig: join(resources, 'build-config.json'),
  };
}

export function devResourcesDir(desktopRoot: string): string {
  return join(desktopRoot, 'build-resources');
}
