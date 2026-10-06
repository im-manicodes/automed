import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(SessionGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list() {
    return this.reports.list();
  }

  /** Genera un reporte manual (no dispara análisis). Reutiliza el que esté 'generando'. */
  @Post()
  @HttpCode(202)
  create() {
    return this.reports.createManual();
  }

  // Rutas fijas antes de ':id'.
  @Get('settings')
  settings() {
    return this.reports.getSettings();
  }

  @Put('settings')
  updateSettings(
    @Body() body: { programado?: unknown; hora?: unknown; zona?: unknown },
  ) {
    return this.reports.updateSettings(body);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.reports.detail(id);
  }

  @Get(':id/download')
  download(@Param('id') id: string): Promise<StreamableFile> {
    return this.reports.download(id);
  }
}
