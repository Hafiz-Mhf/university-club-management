import { Module } from '@nestjs/common';
import { PdpaController } from './pdpa.controller';
import { PdpaService } from './pdpa.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [PdpaController],
  providers: [PdpaService],
})
export class PdpaModule {}
