import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RelayController } from './relay.controller';
import { RelayService } from './relay.service';

@Module({
  imports: [AuthModule],
  controllers: [RelayController],
  providers: [RelayService],
})
export class RelayModule {}
