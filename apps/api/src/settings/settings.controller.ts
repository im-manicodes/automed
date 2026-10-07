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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SessionGuard } from '../auth/session.guard';
import { AiSettingsService } from './ai-settings.service';
import type { AiSettingsInput } from './ai-settings.service';
import { AiTestService } from './ai-test.service';
import { HardwareService } from './hardware.service';
import { OllamaService, isValidModelName } from './ollama.service';

@Controller('settings/ia')
@UseGuards(SessionGuard)
export class SettingsController {
  constructor(
    private readonly ai: AiSettingsService,
    private readonly aiTest: AiTestService,
    private readonly hardware: HardwareService,
    private readonly ollama: OllamaService,
  ) {}

  @Get()
  get() {
    return this.ai.getPublic();
  }

  @Put()
  save(@Body() body: AiSettingsInput) {
    return this.ai.save(body);
  }

  @Post('test')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  test(@Body() body: unknown) {
    return this.aiTest.test(body);
  }

  // Rutas fijas antes de cualquier ruta con parámetros.
  @Get('hardware')
  detect() {
    return this.hardware.detect();
  }

  @Post('ollama/pull')
  @HttpCode(202)
  async pull(@Body() body: { modelo?: unknown }) {
    const modelo = body?.modelo;
    if (!isValidModelName(modelo)) {
      throw new BadRequestException('Indica un nombre de modelo válido');
    }
    const { ollamaUrl } = await this.ai.getEffective();
    const s = this.ollama.startPull(ollamaUrl, modelo);
    return { modelo: s.modelo, estado: s.estado };
  }

  @Get('ollama/pull')
  pullStatus(@Query('modelo') modelo?: string) {
    if (!isValidModelName(modelo)) {
      throw new BadRequestException('Indica un nombre de modelo válido');
    }
    return this.ollama.status(modelo);
  }
}
