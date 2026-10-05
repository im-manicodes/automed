import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobQueueService } from './job-queue.service';
import { JobWorkerService } from './job-worker.service';
import { PipelineService } from './pipeline.service';
import { ThreadStateService } from './thread-state.service';
import { JobsController } from './jobs.controller';
import { SynthesisModule } from '../synthesis/synthesis.module';
import { SynthesisService } from '../synthesis/synthesis.service';
import { OcrModule } from '../ocr/ocr.module';
import { THREAD_SYNTHESIZER } from './pipeline-hooks.interface';

@Module({
  imports: [AuthModule, OcrModule, SynthesisModule],
  providers: [
    JobQueueService,
    JobWorkerService,
    PipelineService,
    ThreadStateService,
    // ATTACHMENT_PROCESSOR lo aporta OcrModule (fase 4). THREAD_SYNTHESIZER lo implementa SynthesisService (fase 5).
    { provide: THREAD_SYNTHESIZER, useExisting: SynthesisService },
  ],
  controllers: [JobsController],
  exports: [PipelineService, JobQueueService],
})
export class JobsModule {}
