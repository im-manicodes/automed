import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { RelayService } from './relay.service';
import type { RelayStatus } from './relay.service';

/** «Usar desde el celular»: estado y control del túnel hacia el relay (solo escritorio). */
@Controller('relay')
@UseGuards(SessionGuard)
export class RelayController {
  constructor(private readonly relay: RelayService) {}

  @Get('status')
  status(): Promise<RelayStatus> {
    return this.relay.status();
  }

  @Post('enable')
  @HttpCode(200)
  enable(): Promise<RelayStatus> {
    return this.relay.enable();
  }

  @Post('disable')
  @HttpCode(200)
  disable(): Promise<RelayStatus> {
    return this.relay.disable();
  }

  /** Mantener la computadora despierta mientras el túnel esté activo (powerSaveBlocker). */
  @Post('keep-awake')
  @HttpCode(200)
  keepAwake(@Body() body: { activo?: unknown }): Promise<RelayStatus> {
    return this.relay.keepAwake(body?.activo);
  }
}
