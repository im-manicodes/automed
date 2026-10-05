import {
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { MicrosoftService } from '../auth/microsoft.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { MailSyncService } from './mail-sync.service';

@Controller('mail')
@UseGuards(SessionGuard)
export class MailController {
  constructor(
    private readonly sync: MailSyncService,
    private readonly microsoft: MicrosoftService,
  ) {}

  /** Devuelve la URL de autorización de Microsoft; el frontend navega a ella. */
  @Post('connect')
  @HttpCode(200)
  connect(@CurrentUser() user: AuthUser) {
    return { url: this.microsoft.buildConnectUrl(user.id) };
  }

  /** "Sincronizar ahora". Requiere Outlook conectado. Si ya hay una en curso responde started=false. */
  @Post('sync')
  async syncNow(@CurrentUser() user: AuthUser) {
    if (!(await this.microsoft.connectedAccount(user.id))) {
      throw new ConflictException('Conecta tu Outlook primero');
    }
    return this.sync.syncNow();
  }

  @Get('status')
  async status(@CurrentUser() user: AuthUser) {
    const acc = await this.microsoft.connectedAccount(user.id);
    if (!acc) return { connected: false, syncing: this.sync.isRunning() };
    return {
      connected: true,
      email: acc.email,
      lastSyncAt: acc.lastSyncAt?.toISOString() ?? null,
      syncing: this.sync.isRunning(),
      ...(this.sync.lastResult?.error
        ? { error: this.sync.lastResult.error }
        : {}),
    };
  }

  /** Desconecta Outlook: borra tokens y estado de sync; conserva hilos, mensajes, adjuntos y síntesis. */
  @Delete('connection')
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthUser) {
    await this.microsoft.disconnect(user.id);
  }
}
