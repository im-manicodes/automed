import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { ReviewService } from './review.service';
import { ReviewController } from './review.controller';
import { OcrRegionsController } from './ocr-regions.controller';

@Module({
  imports: [AuthModule, JobsModule],
  providers: [ReviewService],
  controllers: [ReviewController, OcrRegionsController],
})
export class ReviewModule {}
