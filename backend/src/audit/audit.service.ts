import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  organizationId?: string;
  actorUserId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  isBreakGlass?: boolean;
}

export interface AuditListFilters {
  action?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
  page?: string;
  pageSize?: string;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: entry.metadata as any,
        isBreakGlass: entry.isBreakGlass ?? false,
      },
    });
  }

  async list(organizationId: string, filters: AuditListFilters) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.from) {
      const parsedFrom = new Date(filters.from);
      if (isNaN(parsedFrom.getTime())) throw new BadRequestException('Invalid "from" date');
      createdAt.gte = parsedFrom;
    }
    if (filters.to) {
      const parsedTo = new Date(filters.to);
      if (isNaN(parsedTo.getTime())) throw new BadRequestException('Invalid "to" date');
      createdAt.lte = parsedTo;
    }

    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(filters.pageSize) || DEFAULT_PAGE_SIZE));

    const where: Prisma.AuditLogWhereInput = {
      organizationId,
      ...(filters.action && { action: filters.action }),
      ...(filters.actorUserId && { actorUserId: filters.actorUserId }),
      ...(Object.keys(createdAt).length > 0 && { createdAt }),
    };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          organizationId: true,
          actorUserId: true,
          action: true,
          targetType: true,
          targetId: true,
          metadata: true,
          isBreakGlass: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }
}
