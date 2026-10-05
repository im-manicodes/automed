import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { PipelineService } from '../jobs/pipeline.service';
import { ThreadsService } from './threads.service';

@Controller('threads')
@UseGuards(SessionGuard)
export class ThreadsController {
  constructor(
    private readonly threads: ThreadsService,
    private readonly pipeline: PipelineService,
  ) {}

  @Get()
  list() {
    return this.threads.list();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.threads.detail(id);
  }

  @Post(':id/reprocess')
  @HttpCode(202)
  reprocess(@Param('id') id: string) {
    return this.pipeline.reprocess(id);
  }
}
