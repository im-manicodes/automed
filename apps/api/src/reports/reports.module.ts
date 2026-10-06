import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { LlmModule } from '../llm/llm.module';
import { TemplatesModule } from '../templates/templates.module';
import { GeneratorService } from './generator.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuthModule, JobsModule, LlmModule, TemplatesModule],
  providers: [ReportsService, GeneratorService],
  exports: [ReportsService, GeneratorService],
  controllers: [ReportsController],
})
export class ReportsModule {}
