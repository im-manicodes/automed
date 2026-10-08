import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { StorageSettingsService } from './storage-settings.service';
import type { StorageSettingsInput } from './storage-settings.service';

@Controller('settings/storage')
@UseGuards(SessionGuard)
export class StorageSettingsController {
  constructor(private readonly storage: StorageSettingsService) {}

  @Get()
  get() {
    return this.storage.getPublic();
  }

  @Put()
  save(@Body() body: StorageSettingsInput) {
    return this.storage.save(body);
  }

  @Post('test')
  @HttpCode(200)
  test(@Body() body?: StorageSettingsInput) {
    return this.storage.test(body);
  }
}
