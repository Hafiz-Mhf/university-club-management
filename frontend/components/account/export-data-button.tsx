'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useExportData } from '@/features/pdpa/use-pdpa';
import { ApiError } from '@/lib/api';

export function ExportDataButton() {
  const exportData = useExportData();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    exportData.mutate(undefined, {
      onSuccess: (data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `my-data-export-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
      },
      onError: (err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'),
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={handleClick} disabled={exportData.isPending} className="w-fit">
        {exportData.isPending && <Loader2 className="size-4 animate-spin" />}
        Export my data
      </Button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
