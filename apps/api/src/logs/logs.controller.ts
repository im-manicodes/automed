import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import {
  LOG_NIVELES,
  LogBufferService,
  type LogNivel,
} from './log-buffer.service';

const MAX_LIMIT = 2000;

function parseIntParam(
  v: string | undefined,
  name: string,
): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new BadRequestException(`El parámetro ${name} no es válido`);
  }
  return n;
}

@Controller('settings/logs')
@UseGuards(SessionGuard)
export class LogsController {
  constructor(private readonly buffer: LogBufferService) {}

  /** Líneas del registro. `nivel` = gravedad mínima; `desde` = id ya visto (polling incremental). */
  @Get()
  list(
    @Query('nivel') nivel?: string,
    @Query('desde') desde?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    if (nivel && !LOG_NIVELES.includes(nivel as LogNivel)) {
      throw new BadRequestException('Nivel de registro no válido');
    }
    const lim = parseIntParam(limit, 'limit');
    const { entries, ultimoId } = this.buffer.query({
      nivel: (nivel || undefined) as LogNivel | undefined,
      desde: parseIntParam(desde, 'desde'),
      q: q?.slice(0, 200),
      limit: Math.min(lim ?? 500, MAX_LIMIT) || 1,
    });
    return { entries, ultimoId };
  }

  @Get('descargar')
  download(): StreamableFile {
    const fecha = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const text = this.buffer.toText();
    return new StreamableFile(Buffer.from(text ? `${text}\n` : '', 'utf8'), {
      type: 'text/plain; charset=utf-8',
      disposition: `attachment; filename="registro-api-${fecha}.txt"`,
    });
  }

  @Delete()
  @HttpCode(204)
  clear(): void {
    this.buffer.clear();
  }
}
