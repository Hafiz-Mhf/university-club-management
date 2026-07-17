import { PrismaService } from '../prisma/prisma.service';
import { CURRENT_POLICY_VERSION } from './policy-version';

export async function isAccountConsentStale(prisma: PrismaService, userId: string): Promise<boolean> {
  const latest = await prisma.consentRecord.findFirst({
    where: { userId, purpose: 'account' },
    orderBy: { grantedAt: 'desc' },
  });
  return !latest || latest.policyVersion !== CURRENT_POLICY_VERSION;
}
