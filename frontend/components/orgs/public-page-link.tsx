'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';

export function PublicPageLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? `${window.location.origin}/club/${slug}` : `/club/${slug}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
        <ExternalLink className="size-3.5" />
        View public page
      </a>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? 'Copied!' : 'Copy link'}
      </Button>
    </div>
  );
}
