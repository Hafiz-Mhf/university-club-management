import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(organizationId: string) {
    const [present, absent] = await Promise.all([
      this.prisma.attendance.count({ where: { organizationId, status: 'PRESENT' } }),
      this.prisma.attendance.count({ where: { organizationId, status: 'ABSENT' } }),
    ]);
    const resolved = present + absent;
    return { attendanceRate: resolved === 0 ? null : present / resolved };
  }

  async getCertificates(organizationId: string) {
    const [issued, downloaded] = await Promise.all([
      this.prisma.certificate.count({ where: { organizationId } }),
      this.prisma.certificateDownload.count({ where: { certificate: { organizationId } } }),
    ]);
    return { issued, downloaded };
  }
}
