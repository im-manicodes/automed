import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_INSTRUCCIONES,
  MAX_INSTRUCCIONES,
  validateScopeText,
} from './template-instructions';
import { isTemplateKind, type TemplateKind } from './template-kinds';

export const INSTRUCCIONES_KEY = 'plantilla.instrucciones';

type Stored = Partial<Record<TemplateKind, string>>;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Instrucciones de ámbito por tipo de plantilla (Setting `plantilla.instrucciones`).
 * Ausente = valor por defecto; '' = sin instrucciones. No crean versión de plantilla ni entran en hashes.
 */
@Injectable()
export class TemplateInstructionsService {
  private cache: Stored | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async stored(): Promise<Stored> {
    if (this.cache) return this.cache;
    const row = await this.prisma.setting.findUnique({
      where: { key: INSTRUCCIONES_KEY },
    });
    const out: Stored = {};
    if (isObj(row?.value)) {
      for (const [k, v] of Object.entries(row.value)) {
        if (isTemplateKind(k) && typeof v === 'string') out[k] = v;
      }
    }
    this.cache = out;
    return out;
  }

  defaultFor(kind: TemplateKind): string {
    return DEFAULT_INSTRUCCIONES[kind];
  }

  /** Instrucciones efectivas del tipo (guardadas o, si no hay, las de por defecto). */
  async get(kind: TemplateKind): Promise<string> {
    const s = await this.stored();
    return s[kind] ?? DEFAULT_INSTRUCCIONES[kind];
  }

  async getAll(): Promise<Record<TemplateKind, string>> {
    const s = await this.stored();
    return {
      resumen: s.resumen ?? DEFAULT_INSTRUCCIONES.resumen,
      whatsapp: s.whatsapp ?? DEFAULT_INSTRUCCIONES.whatsapp,
      reporte: s.reporte ?? DEFAULT_INSTRUCCIONES.reporte,
    };
  }

  /** Guarda (texto) o restablece (null) las instrucciones del tipo. 400 en español si no es válido. */
  async save(kind: TemplateKind, texto: string | null): Promise<string> {
    if (texto !== null) {
      const err = validateScopeText(
        texto,
        MAX_INSTRUCCIONES,
        'Las instrucciones',
      );
      if (err) throw new BadRequestException(err);
    }
    const next: Stored = { ...(await this.stored()) };
    if (texto === null) delete next[kind];
    else next[kind] = texto.trim();
    const value = next as Prisma.InputJsonObject;
    await this.prisma.setting.upsert({
      where: { key: INSTRUCCIONES_KEY },
      update: { value },
      create: { key: INSTRUCCIONES_KEY, value },
    });
    this.cache = null;
    return this.get(kind);
  }
}
