import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PipelineService } from '../jobs/pipeline.service';
import { LLM_PROVIDER } from '../llm/llm-provider.interface';
import type { LlmProvider } from '../llm/llm-provider.interface';
import { cropRegionPng } from '../ocr/image-crop';
import { PrismaService } from '../prisma/prisma.service';
import { OcrSettingsService } from '../settings/ocr-settings.service';
import { StorageService } from '../storage/storage.service';
import { withScope } from '../templates/template-instructions';

export const SUGERENCIAS_SYSTEM =
  'Eres un transcriptor de documentos. Recibes el recorte de una línea de un documento ' +
  'escaneado (puede ser manuscrito) y la lectura automática previa, que puede estar mal. ' +
  'Transcribe de forma literal lo que ves, sin resumir ni añadir nada que no esté en la imagen. ' +
  'Propón 2 lecturas distintas y plausibles, ordenadas de más a menos probable. Si se te indica ' +
  'el ámbito o tipo de documentos, úsalo solo como contexto para leer bien lo que la imagen ' +
  'respalda claramente. Si no puedes leer algo, no lo incluyas (nunca escribas [ilegible]). ' +
  'Responde solo con JSON: {"sugerencias": ["lectura 1", "lectura 2"]}.';

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** Extrae hasta 2 sugerencias válidas (tolera texto/markdown alrededor). JSON roto -> []. */
export function parseSugerencias(raw: string, textoActual = ''): string[] {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return [];
  try {
    const obj = JSON.parse(m[0]) as { sugerencias?: unknown };
    if (!Array.isArray(obj?.sugerencias)) return [];
    const vistos = new Set<string>([norm(textoActual)]);
    const out: string[] = [];
    for (const el of obj.sugerencias) {
      if (typeof el !== 'string') continue;
      const t = el.trim();
      if (!t || /\[ilegible\]/i.test(t)) continue;
      const k = norm(t);
      if (vistos.has(k)) continue;
      vistos.add(k);
      out.push(t);
      if (out.length === 2) break;
    }
    return out;
  } catch {
    return [];
  }
}

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
    private readonly storage: StorageService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly ocrSettings: OcrSettingsService,
  ) {}

  private readonly logger = new Logger(ReviewService.name);

  /** Hasta 2 lecturas posibles del recorte (ayuda; no guarda nada ni regenera el resumen). */
  async suggest(
    regionId: string,
    texto: string,
  ): Promise<{ sugerencias: string[] }> {
    const region = await this.prisma.ocrRegion.findUnique({
      where: { id: regionId },
      include: { page: { select: { imageKey: true } } },
    });
    if (!region) throw new NotFoundException('Región no encontrada');
    try {
      const png = await this.storage.get(region.page.imageKey);
      const crop = await cropRegionPng(png, {
        x: region.x,
        y: region.y,
        w: region.w,
        h: region.h,
      });
      const ambito = (await this.ocrSettings.getEffective()).visionAmbito;
      const raw = await this.llm.complete({
        system: withScope(SUGERENCIAS_SYSTEM, ambito),
        prompt: `Lectura actual (puede estar mal): "${texto}"\nPropón 2 lecturas del recorte.`,
        images: [{ mediaType: 'image/png', data: crop }],
        maxTokens: 300,
        temperature: 0,
        task: 'vision_respaldo',
      });
      return { sugerencias: parseSugerencias(raw, texto) };
    } catch {
      this.logger.warn('Falló la sugerencia de una duda');
      return { sugerencias: [] };
    }
  }

  /** Guarda la corrección del usuario, marca 'corregido' y regenera la síntesis de los hilos. */
  async correctRegion(regionId: string, textoUsuario: string) {
    const region = await this.prisma.ocrRegion.findUnique({
      where: { id: regionId },
      include: { page: { select: { sha256: true } } },
    });
    if (!region) throw new NotFoundException('Región no encontrada');
    const updated = await this.prisma.ocrRegion.update({
      where: { id: regionId },
      data: { userText: textoUsuario, status: 'corregido', source: 'usuario' },
    });
    const threads = await this.pipeline.onRegionsChanged(region.page.sha256);
    return {
      id: updated.id,
      status: updated.status,
      textoUsuario: updated.userText,
      hilosReencolados: threads,
    };
  }
}
