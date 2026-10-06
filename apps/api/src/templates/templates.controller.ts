import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { TemplatesService } from './templates.service';
import { parseTemplateKind, type TemplateKind } from './template-kinds';

/** `?kind=` (por defecto 'resumen'); un tipo desconocido responde 400. */
function kindOf(raw: unknown): TemplateKind {
  const k = parseTemplateKind(raw);
  if (!k) throw new BadRequestException('Tipo de plantilla no válido');
  return k;
}

@Controller('templates')
@UseGuards(SessionGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get('active')
  active(@Query('kind') kind?: string) {
    return this.templates.getActive(kindOf(kind));
  }

  @Put('active')
  update(
    @Query('kind') kind: string | undefined,
    @Body() body: { markdown?: unknown; name?: unknown },
  ) {
    return this.templates.updateActive(
      kindOf(kind),
      body?.markdown,
      body?.name,
    );
  }

  @Post('reset')
  @HttpCode(200)
  reset(@Query('kind') kind?: string) {
    return this.templates.reset(kindOf(kind));
  }
}
