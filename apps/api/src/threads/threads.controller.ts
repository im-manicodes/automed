import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { ThreadsService } from './threads.service';

@Controller('threads')
@UseGuards(SessionGuard)
export class ThreadsController {
  constructor(private readonly threads: ThreadsService) {}

  @Get()
  list() {
    return this.threads.list();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.threads.detail(id);
  }
}
