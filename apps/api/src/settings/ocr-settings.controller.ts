import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SessionGuard } from '../auth/session.guard';
import { OcrProbeService } from '../ocr/ocr-probe.service';
import { OcrSettingsService } from './ocr-settings.service';
import type { OcrSettingsInput } from './ocr-settings.service';

@Controller('settings/ocr')
@UseGuards(SessionGuard)
export class OcrSettingsController {
  constructor(
    private readonly settings: OcrSettingsService,
    private readonly probeService: OcrProbeService,
  ) {}

  private async view() {
    const eff = await this.settings.getEffective();
    return {
      motor: eff.motor,
      origen: eff.origen,
      textractMode: eff.textractMode,
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
}
