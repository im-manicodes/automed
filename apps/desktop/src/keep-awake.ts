import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Lo que usamos de `powerSaveBlocker` de Electron (inyectable para probar sin Electron). */
export interface PowerBlockerLike {
  start(type: 'prevent-app-suspension'): number;
  stop(id: number): void;
  isStarted(id: number): boolean;
}

/**
 * «Mantener la computadora despierta»: preferencia persistida en `<dataDir>/relay-prefs.json`
 * (desactivada por defecto) que solo se APLICA (powerSaveBlocker `prevent-app-suspension`) mientras
 * el túnel al celular esté activo. No es un secreto, por eso no vive en secrets.bin.
 */
export class KeepAwake {
  private id: number | null = null;
  private pref: boolean;
  private readonly file: string;

  constructor(
    dataDir: string,
    private readonly blocker: PowerBlockerLike,
  ) {
    this.file = join(dataDir, 'relay-prefs.json');
    this.pref = this.read();
  }

  get preferencia(): boolean {
    return this.pref;
  }

  /** ¿Hay un bloqueo de suspensión vigente ahora mismo? */
  get aplicado(): boolean {
    return this.id !== null && this.blocker.isStarted(this.id);
  }

  setPreferencia(v: boolean, tunelActivo: boolean) {
    this.pref = v;
    this.write();
    this.sync(tunelActivo);
  }

  /** Aplica o suelta el bloqueo según preferencia y estado del túnel (idempotente). */
  sync(tunelActivo: boolean) {
    const quiere = this.pref && tunelActivo;
    if (quiere && !this.aplicado) this.id = this.blocker.start('prevent-app-suspension');
    else if (!quiere && this.id !== null) {
      if (this.blocker.isStarted(this.id)) this.blocker.stop(this.id);
      this.id = null;
    }
  }

  private read(): boolean {
    try {
      if (!existsSync(this.file)) return false;
      return (JSON.parse(readFileSync(this.file, 'utf8')) as { mantenerDespierto?: unknown }).mantenerDespierto === true;
    } catch {
      return false;
    }
  }

  private write() {
    try {
      mkdirSync(join(this.file, '..'), { recursive: true });
      writeFileSync(this.file, JSON.stringify({ mantenerDespierto: this.pref }), { mode: 0o600 });
    } catch {
      /* sin disco: la preferencia solo dura esta sesión */
    }
  }
}
