import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantScopeMiddleware } from './tenant-scope.middleware';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    this.$use(tenantScopeMiddleware);
    await this.$connect();
  }

  // Without this, every app.close() (one per e2e suite) leaks its connection
  // pool until the jest worker process exits — enough suites in one worker
  // exhausts Postgres max_connections.
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
