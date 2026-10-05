import { Injectable } from '@nestjs/common';
import {
  AttachmentProcessor,
  ThreadSynthesizer,
} from './pipeline-hooks.interface';

/** Stub (fase 3): no hace OCR; el pipeline marca el adjunto como listo. */
@Injectable()
export class NoopAttachmentProcessor implements AttachmentProcessor {
  process(): Promise<void> {
    return Promise.resolve();
  }
}

/** Stub (fase 3): no genera síntesis; el pipeline marca el hilo como listo. */
@Injectable()
export class NoopThreadSynthesizer implements ThreadSynthesizer {
  synthesize(): Promise<void> {
    return Promise.resolve();
  }
}
