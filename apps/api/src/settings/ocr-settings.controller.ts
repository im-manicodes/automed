import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SessionGuard } from '../auth/session.guard';
import { isDesktop } from '../ocr/app-mode';
import { OcrLocalRunner } from '../ocr/ocr-local-runner.service';
import type { LocalServiceStatus } from '../ocr/ocr-local-runner.service';
import { OcrProbeService } from '../ocr/ocr-probe.service';
import {
  PYTHON_RANGE,
  PYTHON_REQUIRED,
  PythonEnvService,
  buildGuide,
} from '../ocr/python-env.service';
import type { PythonInfo } from '../ocr/python-env.service';
import { OcrSettingsService } from './ocr-settings.service';
import type { OcrSettingsInput } from './ocr-settings.service';

const NOT_AVAILABLE = 'No disponible en este entorno';

@Controller('settings/ocr')
@UseGuards(SessionGuard)
export class OcrSettingsController {
  constructor(
    private readonly config: ConfigService,
    private readonly settings: OcrSettingsService,
    private readonly python: PythonEnvService,
    private readonly runner: OcrLocalRunner,
    private readonly probeService: OcrProbeService,
  ) {}

  private requireDesktop() {
    if (!isDesktop(this.config)) throw new ConflictException(NOT_AVAILABLE);
  }

  private async view() {
    const eff = await this.settings.getEffective();
    const escritorio = isDesktop(this.config);
    const python: PythonInfo = escritorio
      ? await this.python.detect()
      : {
          requerido: PYTHON_REQUIRED,
          rango: PYTHON_RANGE,
          detectado: false,
          compatible: false,
          motivo: NOT_AVAILABLE,
          guia: buildGuide(this.python.so),
        };
    // No exponer los datos internos de la detección.
    const {
      requerido,
      rango,
      detectado,
      version,
      ejecutable,
      compatible,
      motivo,
      guia,
    } = python;
    const servicioLocal: LocalServiceStatus = escritorio
      ? this.runner.getStatus()
      : await this.probeService.serverLocalStatus();
    return {
      motor: eff.motor,
      origen: eff.origen,
      textractMode: eff.textractMode,
      entorno: { escritorio, so: this.python.so, servidor: !escritorio },
      python: {
        requerido,
        rango,
        detectado,
        ...(version ? { version } : {}),
        ...(ejecutable ? { ejecutable } : {}),
        compatible,
        ...(motivo ? { motivo } : {}),
        guia,
      },
      entornoPython: escritorio
        ? this.python.entornoEstado()
        : { estado: 'sin_preparar' as const },
      servicioLocal,
    };
  }

  @Get()
  get() {
    return this.view();
  }

  @Put()
  async save(@Body() body: OcrSettingsInput) {
    await this.settings.save(body);
    await this.runner.reconcile();
    return this.view();
  }

  @Post('python/instalar')
  @HttpCode(202)
  async instalar() {
    this.requireDesktop();
    return this.python.prepare();
  }

  @Get('python/progreso')
  progreso() {
    this.requireDesktop();
    return this.python.progress();
  }

  @Post('probar')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  probar() {
    return this.probeService.probe();
  }
}
