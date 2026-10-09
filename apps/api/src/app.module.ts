import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { ThreadsModule } from './threads/threads.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { OcrModule } from './ocr/ocr.module';
import { LlmModule } from './llm/llm.module';
import { SynthesisModule } from './synthesis/synthesis.module';
import { TemplatesModule } from './templates/templates.module';
import { ReviewModule } from './review/review.module';
import { SettingsModule } from './settings/settings.module';
import { StorageModule } from './storage/storage.module';
import { PrismaModule } from './prisma/prisma.module';
import { JobsModule } from './jobs/jobs.module';
import { ReportsModule } from './reports/reports.module';
import { EventsModule } from './events/events.module';
import { LogsModule } from './logs/logs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    MailModule,
    ThreadsModule,
    AttachmentsModule,
    OcrModule,
    LlmModule,
    SynthesisModule,
    TemplatesModule,
    ReviewModule,
    SettingsModule,
    StorageModule,
    JobsModule,
    ReportsModule,
    EventsModule,
    LogsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
