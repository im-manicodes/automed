import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { EventsService } from './events.service';
import type { CreateEventBody } from './events.service';

@Controller()
@UseGuards(SessionGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /** Borrador de la IA (una llamada con la síntesis vigente). No guarda nada. */
  @Post('threads/:id/event-draft')
  @HttpCode(200)
  draft(@Param('id') id: string) {
    return this.events.draft(id);
  }

  @Post('threads/:id/events')
  @HttpCode(201)
  create(@Param('id') id: string, @Body() body: CreateEventBody) {
    return this.events.create(id, body);
  }

  @Get('threads/:id/events')
  list(@Param('id') id: string) {
    return this.events.list(id);
  }

  @Delete('events/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.events.remove(id);
  }
}
