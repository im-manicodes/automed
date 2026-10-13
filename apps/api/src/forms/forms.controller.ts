import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard } from '../auth/session.guard';
import { FormsService } from './forms.service';

@Controller()
@UseGuards(SessionGuard)
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Get('forms')
  list() {
    return this.forms.listFormats();
  }

  /** Borrador guardado (sin IA). */
  @Get('threads/:id/forms/:formato/draft')
  saved(@Param('id') id: string, @Param('formato') formato: string) {
    return this.forms.getSaved(id, formato);
  }

  /** Guarda las ediciones del usuario. */
  @Put('threads/:id/forms/:formato/draft')
  save(
    @Param('id') id: string,
    @Param('formato') formato: string,
    @Body() body: { valores?: unknown },
  ) {
    return this.forms.saveEdits(id, formato, body?.valores);
  }

  /** Primera propuesta (una llamada a la IA) o, con `actualizar`, fusión sin pisar lo editado. */
  @Post('threads/:id/form-draft')
  @HttpCode(200)
  draft(
    @Param('id') id: string,
    @Body() body: { formato?: unknown; actualizar?: unknown },
  ) {
    return this.forms.draft(id, body?.formato, {
      actualizar: body?.actualizar === true,
    });
  }

  /** Vista previa en PNG (data URLs) del formato llenado; no guarda ni llama a la IA. */
  @Post('threads/:id/forms/:formato/preview')
  @HttpCode(200)
  preview(
    @Param('id') id: string,
    @Param('formato') formato: string,
    @Body() body: { valores?: unknown },
  ) {
    return this.forms.preview(id, formato, body?.valores);
  }

  @Post('threads/:id/forms/:formato/pdf')
  @HttpCode(200)
  async pdf(
    @Param('id') id: string,
    @Param('formato') formato: string,
    @Body() body: { valores?: unknown },
    @Res() res: Response,
  ): Promise<void> {
    const { bytes, filename } = await this.forms.render(
      id,
      formato,
      body?.valores,
    );
    res
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      })
      .end(Buffer.from(bytes));
  }
}
