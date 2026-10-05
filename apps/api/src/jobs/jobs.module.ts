import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobQueueService } from './job-queue.service';
import { JobWorkerService } from './job-worker.service';
import { PipelineService } from './pipeline.service';
import { ThreadStateService } from './thread-state.service';
import { JobsController } from './jobs.controller';
import { NoopAttachmentProcessor, NoopThreadSynthesizer } from './noop-hooks';
import {
  ATTACHMENT_PROCESSOR,
  THREAD_SYNTHESIZER,
} from './pipeline-hooks.interface';

@Module({
  imports: [AuthModule],
  providers: [
    JobQueueService,
    JobWorkerService,
    PipelineService,
    ThreadStateService,
    // Enganches: fase 4 (OcrEngine) y fase 5 (LlmProvider) reemplazan estos useClass.
    { provide: ATTACHMENT_PROCESSOR, useClass: NoopAttachmentProcessor },
    { provide: THREAD_SYNTHESIZER, useClass: NoopThreadSynthesizer },
  ],
  controllers: [JobsController],
  exports: [PipelineService, JobQueueService],
})
export class JobsModule {}
