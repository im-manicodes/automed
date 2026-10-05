import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ThreadsService } from './threads.service';
import { ThreadsController } from './threads.controller';

@Module({
  imports: [AuthModule],
  providers: [ThreadsService],
  controllers: [ThreadsController],
})
export class ThreadsModule {}
