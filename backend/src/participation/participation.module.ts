import { Module } from '@nestjs/common';
import { ParticipationController } from './participation.controller';
import { ParticipationService } from './participation.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ParticipationController],
  providers: [ParticipationService],
})
export class ParticipationModule {}
