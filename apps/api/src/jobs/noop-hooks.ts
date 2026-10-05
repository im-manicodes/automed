import { Injectable } from '@nestjs/common';
import { ThreadSynthesizer } from './pipeline-hooks.interface';

/** Stub (fase 3): no genera síntesis; el pipeline marca el hilo como listo. */
@Injectable()
export class NoopThreadSynthesizer implements ThreadSynthesizer {
  synthesize(): Promise<void> {
    return Promise.resolve();
  }
}
