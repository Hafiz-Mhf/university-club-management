export const CERTIFICATE_QUEUE = 'certificates';

export const CERTIFICATE_GENERATE_JOB = 'certificate.generate';

export interface CertificateGenerateJobPayload {
  organizationId: string;
  eventId: string;
  userId: string;
  actorUserId?: string;
}
