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
import { TemplateInstructionsService } from './template-instructions.service';
import { MAX_INSTRUCCIONES, validateScopeText } from './template-instructions';
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
  constructor(
    private readonly templates: TemplatesService,
    private readonly instructions: TemplateInstructionsService,
  ) {}

  /** Plantilla + instrucciones efectivas y las de por defecto. */
  private async view(kind: TemplateKind, tpl?: unknown) {
    return {
      ...(tpl ?? (await this.templates.getActive(kind))),
      instrucciones: await this.instructions.get(kind),
      instruccionesPorDefecto: this.instructions.defaultFor(kind),
    };
  }

  @Get('active')
  active(@Query('kind') kind?: string) {
    return this.view(kindOf(kind));
  }

  /**
   * `markdown` crea versión nueva; `instrucciones` (texto, '' o null = restablecer) solo se guarda
   * en Ajustes y NO crea versión.
   */
  @Put('active')
  async update(
    @Query('kind') kind: string | undefined,
    @Body()
    body: { markdown?: unknown; name?: unknown; instrucciones?: unknown },
  ) {
    const k = kindOf(kind);
    const hasMd = body?.markdown !== undefined;
    const hasIns = body?.instrucciones !== undefined;
    if (!hasMd && !hasIns)
      throw new BadRequestException(
        'Envía el formato (markdown) o las instrucciones',
      );
    if (hasIns && body.instrucciones !== null) {
      const err = validateScopeText(
        body.instrucciones,
        MAX_INSTRUCCIONES,
        'Las instrucciones',
      );
      if (err) throw new BadRequestException(err);
    }
    let tpl: unknown;
    if (hasMd)
      tpl = await this.templates.updateActive(k, body.markdown, body.name);
    if (hasIns)
      await this.instructions.save(k, body.instrucciones as string | null);
    return this.view(k, tpl);
  }

  @Post('reset')
  @HttpCode(200)
  reset(@Query('kind') kind?: string) {
    return this.templates.reset(kindOf(kind));
  }
}
