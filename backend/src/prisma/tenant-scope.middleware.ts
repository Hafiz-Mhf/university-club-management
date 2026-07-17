import { Prisma } from '@prisma/client';

// Models carrying organizationId that must never be queried unscoped.
export const TENANT_SCOPED_MODELS: Prisma.ModelName[] = ['Membership', 'AuditLog', 'Event', 'Registration', 'Attendance', 'Certificate', 'OrgFile', 'MeetingMinutes', 'Asset', 'GalleryPhoto', 'Achievement', 'FeedbackResponse'];

// Filtering actions where a missing organizationId filter would leak across tenants.
// findUnique/findUniqueOrThrow (unique index) and create/createMany (no where) are exempt by design.
const SCOPED_ACTIONS = new Set<Prisma.PrismaAction>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'updateMany',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

// Legacy $use middleware (chosen so the injected singleton PrismaService stays the client).
export const tenantScopeMiddleware: Prisma.Middleware = async (params, next) => {
  const model = params.model as Prisma.ModelName | undefined;
  if (model && TENANT_SCOPED_MODELS.includes(model) && SCOPED_ACTIONS.has(params.action)) {
    const where = (params.args ?? {}).where;
    if (!where || where.organizationId === undefined || where.organizationId === null) {
      throw new Error(
        `Tenant scope violation: ${params.action} on ${params.model} must filter by organizationId`,
      );
    }
  }
  return next(params);
};
