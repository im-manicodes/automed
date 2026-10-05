import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GraphService } from './graph.service';
import { MailSyncService } from './mail-sync.service';
import { MailController } from './mail.controller';

@Module({
  imports: [AuthModule],
  providers: [GraphService, MailSyncService],
  controllers: [MailController],
  exports: [MailSyncService],
})
export class MailModule {}
