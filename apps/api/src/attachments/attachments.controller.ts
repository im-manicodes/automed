import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { AttachmentsService } from './attachments.service';

@Controller('attachments')
@UseGuards(SessionGuard)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get(':id/pages')
  pages(@Param('id') id: string) {
    return this.attachments.listPages(id);
  }

  @Get(':id/pages/:n/image')
  async image(
    @Param('id') id: string,
    @Param('n', ParseIntPipe) n: number,
  ): Promise<StreamableFile> {
    const bytes = await this.attachments.pageImage(id, n);
    return new StreamableFile(bytes, {
      type: 'image/png',
      disposition: 'inline',
    });
  }
}
