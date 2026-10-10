import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { SynthesisService } from './synthesis.service';
import { parseTemplateKind } from '../templates/template-kinds';
import {
  MAX_INSTRUCCIONES,
  validateScopeText,
} from '../templates/template-instructions';

@Controller()
@UseGuards(SessionGuard)
export class SynthesisController {
  constructor(private readonly synthesis: SynthesisService) {}

  /** Última versión + historial resumido. */
  @Get('threads/:id/synthesis')
  get(@Param('id') id: string) {
    return this.synthesis.getForThread(id);
  }

  /** Mensaje de WhatsApp redactado por IA solo con el último correo (no guarda nada). */
  @Post('threads/:id/whatsapp-last')
  @HttpCode(200)
  whatsappLast(@Param('id') id: string) {
    return this.synthesis.whatsappLast(id);
  }

  /** Vista previa de la plantilla (activa o `markdown` propuesto) del `kind` dado con un ejemplo. */
  @Post('templates/preview')
  @HttpCode(200)
  preview(
    @Body()
    body: {
      markdown?: string;
      kind?: unknown;
      instrucciones?: unknown;
    },
  ) {
    const kind = parseTemplateKind(body?.kind);
    if (!kind) throw new BadRequestException('Tipo de plantilla no válido');
    let instrucciones: string | undefined;
    if (body?.instrucciones !== undefined && body.instrucciones !== null) {
      const err = validateScopeText(
        body.instrucciones,
        MAX_INSTRUCCIONES,
        'Las instrucciones',
      );
      if (err) throw new BadRequestException(err);
      instrucciones = body.instrucciones as string;
    }
    return this.synthesis.preview(
      typeof body?.markdown === 'string' ? body.markdown : undefined,
      kind,
      instrucciones,
    );
  }
}
