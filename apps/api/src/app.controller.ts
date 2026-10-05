import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Público (sin sesión): lo usa el healthcheck de docker compose. GET /api/health */
  @Get('health')
  health() {
    return this.appService.health();
  }
}
