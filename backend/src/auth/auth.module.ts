import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { RefreshTokenRepository } from './refresh-token.repository';

@Module({
  imports: [JwtModule.register({}), PassportModule],
  providers: [AuthService, JwtStrategy, RefreshTokenRepository],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
