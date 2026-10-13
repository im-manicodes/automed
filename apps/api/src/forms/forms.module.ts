import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../llm/llm.module';
import { FormsService } from './forms.service';
import { FormsController } from './forms.controller';

@Module({
  imports: [AuthModule, LlmModule],
  providers: [FormsService],
  controllers: [FormsController],
})
export class FormsModule {}
