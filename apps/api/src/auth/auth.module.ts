import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TokenCryptoService } from './token-crypto.service';
import { SessionService } from './session.service';
import { SessionGuard } from './session.guard';

@Module({
  providers: [AuthService, TokenCryptoService, SessionService, SessionGuard],
  controllers: [AuthController],
  exports: [AuthService, TokenCryptoService, SessionService, SessionGuard],
})
export class AuthModule {}
