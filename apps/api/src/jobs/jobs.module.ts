import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobQueueService } from './job-queue.service';
import { JobWorkerService } from './job-worker.service';
import { PipelineService } from './pipeline.service';
import { ThreadStateService } from './thread-state.service';
import { JobsController } from './jobs.controller';
import { NoopThreadSynthesizer } from './noop-hooks';
import { OcrModule } from '../ocr/ocr.module';
import { THREAD_SYNTHESIZER } from './pipeline-hooks.interface';

@Module({
  imports: [AuthModule, OcrModule],
  providers: [
    JobQueueService,
    JobWorkerService,
    PipelineService,
    ThreadStateService,
    // ATTACHMENT_PROCESSOR lo aporta OcrModule (fase 4). Fase 5 reemplaza el sintetizador.
    { provide: THREAD_SYNTHESIZER, useClass: NoopThreadSynthesizer },
  ],
  controllers: [JobsController],
  exports: [PipelineService, JobQueueService],
})
export class JobsModule {}
