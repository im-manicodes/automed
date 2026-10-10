import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { TemplateInstructionsService } from './template-instructions.service';

@Module({
  imports: [AuthModule],
  providers: [TemplatesService, TemplateInstructionsService],
  controllers: [TemplatesController],
  exports: [TemplatesService, TemplateInstructionsService],
})
export class TemplatesModule {}
