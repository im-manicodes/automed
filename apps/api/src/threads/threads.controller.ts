import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { PipelineService } from '../jobs/pipeline.service';
import { ProcessStatus } from '../generated/prisma/client';
import { ThreadsService } from './threads.service';

/** Máximo de hilos por petición de análisis masivo. */
export const MAX_ANALYZE_BATCH = 50;

function optionalBool(v: unknown, field: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean')
    throw new BadRequestException(`${field} debe ser verdadero o falso`);
  return v;
}

@Controller('threads')
@UseGuards(SessionGuard)
export class ThreadsController {
  constructor(
    private readonly threads: ThreadsService,
    private readonly pipeline: PipelineService,
  ) {}

  @Get()
  list(@Query('status') status?: string) {
    if (status !== undefined && !(status in ProcessStatus))
      throw new BadRequestException('Estado no válido');
    return this.threads.list(status as ProcessStatus | undefined);
  }

  /** Análisis (OCR + LLM) de varios hilos: solo ocurre porque el usuario lo pide. */
  @Post('analyze')
  @HttpCode(202)
  async analyzeMany(@Body() body: { ids?: unknown; seguimiento?: unknown }) {
    const ids = body?.ids;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      !ids.every((i) => typeof i === 'string' && i !== '')
    )
      throw new BadRequestException('Indica los tickets a analizar');
    if (ids.length > MAX_ANALYZE_BATCH)
      throw new BadRequestException(
        `Máximo ${MAX_ANALYZE_BATCH} tickets por vez`,
      );
    const results = await this.pipeline.analyzeMany(ids as string[], {
      seguimiento: optionalBool(body.seguimiento, 'seguimiento'),
    });
    return { results };
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.threads.detail(id);
  }

  @Post(':id/analyze')
  @HttpCode(202)
  analyze(@Param('id') id: string, @Body() body?: { seguimiento?: unknown }) {
    return this.pipeline.analyze(id, {
      seguimiento: optionalBool(body?.seguimiento, 'seguimiento'),
    });
  }

  @Patch(':id/seguimiento')
  setSeguimiento(
    @Param('id') id: string,
    @Body() body: { seguimiento?: unknown },
  ) {
    const v = optionalBool(body?.seguimiento, 'seguimiento');
    if (v === undefined) throw new BadRequestException('Indica seguimiento');
    return this.threads.setSeguimiento(id, v);
  }

  @Post(':id/reprocess')
  @HttpCode(202)
  reprocess(@Param('id') id: string) {
    return this.pipeline.reprocess(id);
  }

  /** Re-analiza solo el último correo (OCR de sus adjuntos + síntesis incremental). */
  @Post(':id/reanalyze-last')
  @HttpCode(202)
  reanalyzeLast(@Param('id') id: string) {
    return this.pipeline.reanalyzeLast(id);
  }

  /** Genera el resumen sin esperar la revisión manual: las zonas dudosas se dejan fuera. */
  @Post(':id/synthesis/continue')
  @HttpCode(202)
  continueWithoutReview(@Param('id') id: string) {
    return this.pipeline.continueWithoutReview(id);
  }

  /** Regenera la síntesis en modo COMPLETO (nueva versión, mayor consumo) sin reprocesar adjuntos/OCR. */
  @Post(':id/synthesis/regenerate')
  @HttpCode(202)
  regenerateSynthesis(@Param('id') id: string) {
    return this.pipeline.regenerateSynthesis(id);
  }
}
