import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { ReviewService } from './review.service';

@Controller('ocr/regions')
@UseGuards(SessionGuard)
export class OcrRegionsController {
  constructor(private readonly review: ReviewService) {}

  @Patch(':id')
  correct(@Param('id') id: string, @Body() body: { textoUsuario?: unknown }) {
    const texto = body?.textoUsuario;
    if (typeof texto !== 'string' || texto.trim() === '') {
      throw new BadRequestException('Escribe el texto correcto');
    }
    if (texto.length > 2000) {
      throw new BadRequestException('El texto es demasiado largo');
    }
    return this.review.correctRegion(id, texto.trim());
  }

  /** Hasta 2 lecturas posibles del recorte; no persiste nada. */
  @Post(':id/suggest')
  @HttpCode(200)
  suggest(@Param('id') id: string, @Body() body: { texto?: unknown }) {
    const t = body?.texto;
    const texto = typeof t === 'string' ? t.slice(0, 2000) : '';
    return this.review.suggest(id, texto);
  }
}
