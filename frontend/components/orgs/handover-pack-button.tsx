'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDownloadHandoverPack } from '@/features/handover/use-handover';
import { ApiError } from '@/lib/api';

export function HandoverPackButton({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const download = useDownloadHandoverPack(orgId);
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    download.mutate(undefined, {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `handover-pack-${orgSlug}-${new Date().toISOString().slice(0, 10)}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
      },
      onError: (err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'),
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={handleClick} disabled={download.isPending} className="w-fit">
        {download.isPending && <Loader2 className="size-4 animate-spin" />}
        Download handover pack
      </Button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
