import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { JobQueueService } from './job-queue.service';

@Controller('jobs')
@UseGuards(SessionGuard)
export class JobsController {
  constructor(private readonly queue: JobQueueService) {}

  @Get('status')
  status() {
    return this.queue.statusCounts();
  }
}
