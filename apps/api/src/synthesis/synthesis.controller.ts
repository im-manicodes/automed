import {
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

@Controller()
@UseGuards(SessionGuard)
export class SynthesisController {
  constructor(private readonly synthesis: SynthesisService) {}

  /** Última versión + historial resumido. */
  @Get('threads/:id/synthesis')
  get(@Param('id') id: string) {
    return this.synthesis.getForThread(id);
  }

  /** Vista previa de la plantilla (activa o `markdown` propuesto) con un hilo de ejemplo. */
  @Post('templates/preview')
  @HttpCode(200)
  preview(@Body() body: { markdown?: string }) {
    return this.synthesis.preview(
      typeof body?.markdown === 'string' ? body.markdown : undefined,
    );
  }
}
