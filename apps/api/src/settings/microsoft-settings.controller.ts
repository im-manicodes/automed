import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { MicrosoftSettingsService } from './microsoft-settings.service';
import type { MicrosoftSettingsInput } from './microsoft-settings.service';

@Controller('settings/microsoft')
@UseGuards(SessionGuard)
export class MicrosoftSettingsController {
  constructor(private readonly microsoft: MicrosoftSettingsService) {}

  @Get()
  get() {
    return this.microsoft.getPublic();
  }

  @Put()
  save(@Body() body: MicrosoftSettingsInput) {
    return this.microsoft.save(body);
  }
}
