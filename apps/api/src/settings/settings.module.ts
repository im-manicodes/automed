import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { AiSettingsService } from './ai-settings.service';
import { HardwareService } from './hardware.service';
import { OllamaService } from './ollama.service';
import { AiTestService } from './ai-test.service';

@Module({
  imports: [AuthModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])],
  providers: [
    SettingsService,
    AiSettingsService,
    HardwareService,
    OllamaService,
    AiTestService,
  ],
  controllers: [SettingsController],
  exports: [AiSettingsService],
})
export class SettingsModule {}
