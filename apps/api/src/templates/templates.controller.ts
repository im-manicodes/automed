import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { TemplatesService } from './templates.service';

@Controller('templates')
@UseGuards(SessionGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get('active')
  active() {
    return this.templates.getActive();
  }

  @Put('active')
  update(@Body() body: { markdown?: unknown; name?: unknown }) {
    return this.templates.updateActive(body?.markdown, body?.name);
  }

  @Post('reset')
  @HttpCode(200)
  reset() {
    return this.templates.reset();
  }
}
