import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { AuthService } from '../auth/auth.service';
import { MailSyncService } from './mail-sync.service';

@Controller('mail')
@UseGuards(SessionGuard)
export class MailController {
  constructor(
    private readonly sync: MailSyncService,
    private readonly auth: AuthService,
  ) {}

  /** "Sincronizar ahora". Si ya hay una sincronización en curso responde started=false. */
  @Post('sync')
  syncNow() {
    return this.sync.syncNow();
  }

  @Get('status')
  async status() {
    return {
      connectedEmail: await this.auth.connectedEmail(),
      running: this.sync.isRunning(),
      last: this.sync.lastResult,
    };
  }
}
