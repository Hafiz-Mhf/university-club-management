'use client';

import { Download } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { useMyCertificate } from '@/features/certificates/use-certificates';

export function MyCertificatePanel({ orgId, eventId }: { orgId: string; eventId: string }) {
  const certificate = useMyCertificate(orgId, eventId);

  if (!certificate.data) return null;

  return (
    <a
      href={certificate.data.downloadUrl}
      target="_blank"
      rel="noreferrer"
      className={buttonVariants({ variant: 'secondary', size: 'sm' })}
    >
      <Download className="size-3.5" />
      Download certificate
    </a>
  );
}
