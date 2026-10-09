import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SessionGuard } from '../auth/session.guard';
import { OcrProbeService } from '../ocr/ocr-probe.service';
import { OcrInstallerService } from '../ocr/ocr-installer.service';
import { OcrSettingsService } from './ocr-settings.service';
import type { OcrSettingsInput } from './ocr-settings.service';

@Controller('settings/ocr')
@UseGuards(SessionGuard)
export class OcrSettingsController {
  constructor(
    private readonly settings: OcrSettingsService,
    private readonly probeService: OcrProbeService,
    private readonly installer: OcrInstallerService,
  ) {}

  private async view() {
    const eff = await this.settings.getEffective();
    return {
      motor: eff.motor,
      origen: eff.origen,
      textractMode: eff.textractMode,
      visionRetry: eff.visionRetry,
      visionMaxRegions: eff.visionMaxRegions,
      renderDpi: eff.renderDpi,
      ...(await this.settings.getAzurePublic()),
      entorno: { servidor: true },
      servicioLocal: await this.probeService.serverLocalStatus(),
    };
  }

  @Get()
  get() {
    return this.view();
  }

  @Put()
  async save(@Body() body: OcrSettingsInput) {
    await this.settings.save(body);
    return this.view();
  }

  @Post('probar')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  probar() {
    return this.probeService.probe();
  }

  /** Estado del OCR local gestionado por la API: instalación, progreso, proceso y últimas líneas. */
  @Get('local')
  local() {
    return this.installer.view();
  }

  /** Instala (o reinstala) en segundo plano; 409 si ya hay una instalación o es servicio externo. */
  @Post('local/instalar')
  @HttpCode(202)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async instalar() {
    await this.installer.install();
    return this.installer.view();
  }

  @Post('local/iniciar')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async iniciar() {
    this.installer.startService();
    return this.installer.view();
  }

  @Post('local/detener')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async detener() {
    await this.installer.stopService();
    return this.installer.view();
  }

  @Delete('local')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async desinstalar() {
    await this.installer.uninstall();
    return this.installer.view();
  }
}
