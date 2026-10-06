import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportsModule } from '../reports/reports.module';
import { TemplatesModule } from '../templates/templates.module';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

@Module({
  imports: [AuthModule, ReportsModule, TemplatesModule],
  providers: [EventsService],
  controllers: [EventsController],
})
export class EventsModule {}
