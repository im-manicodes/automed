import { Module } from '@nestjs/common';
import { SynthesisService } from './synthesis.service';
import { SynthesisController } from './synthesis.controller';

@Module({
  providers: [SynthesisService],
  controllers: [SynthesisController],
})
export class SynthesisModule {}
