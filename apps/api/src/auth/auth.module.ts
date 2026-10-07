import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthService, MIN_JWT_SECRET_LENGTH } from './auth.service';
import { AuthController } from './auth.controller';
import { TokenCryptoService } from './token-crypto.service';
import { SessionGuard } from './session.guard';
import { PasswordService } from './password.service';
import { MicrosoftService } from './microsoft.service';
import { LoginThrottlerGuard } from './login-throttler.guard';
import { IpThrottlerGuard } from './ip-throttler.guard';
import { UsersService } from '../users/users.service';

/** JWT_SECRET es obligatorio: sin él (o si es corto) la API no arranca. */
export function jwtSecretFrom(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET falta o es demasiado corto (mínimo ${MIN_JWT_SECRET_LENGTH} caracteres). Genera uno con: openssl rand -base64 48`,
    );
  }
  return secret;
}

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: jwtSecretFrom(config),
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
  ],
  providers: [
    AuthService,
    TokenCryptoService,
    SessionGuard,
    PasswordService,
    MicrosoftService,
    LoginThrottlerGuard,
    IpThrottlerGuard,
    UsersService,
  ],
  controllers: [AuthController],
  exports: [
    AuthService,
    TokenCryptoService,
    SessionGuard,
    PasswordService,
    MicrosoftService,
    UsersService,
    JwtModule,
  ],
})
export class AuthModule {}
