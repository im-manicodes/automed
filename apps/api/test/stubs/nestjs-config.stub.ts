/* eslint-disable @typescript-eslint/no-unused-vars */
// @nestjs/config v12 es ESM-only y Jest (CJS) no puede cargarlo; los tests usan este stub.
export class ConfigService {
  get(_key: string, def?: unknown): unknown {
    return def;
  }
  getOrThrow(_key?: string): unknown {
    return undefined;
  }
}
