'use client';

import { useRef, useState } from 'react';
import { ImageIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useDeleteBanner,
  useDeleteLogo,
  useUploadBanner,
  useUploadLogo,
} from '@/features/orgs/use-orgs';
import { validateBrandingImage } from '@/features/orgs/validate-branding-image';
import { ApiError } from '@/lib/api';
import type { Organization } from '@/types/api';

function BrandingSlot({
  label,
  imageUrl,
  onUpload,
  onRemove,
  isUploading,
  isRemoving,
}: {
  label: string;
  imageUrl: string | null | undefined;
  onUpload: (file: File) => void;
  onRemove: () => void;
  isUploading: boolean;
  isRemoving: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex h-24 w-40 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed MinIO URL, next/image adds nothing here
          <img src={imageUrl} alt={label} className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="size-6 text-foreground-subtle" />
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label={`${label} file`}
        className="text-sm"
        onChange={() => setError(null)}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isUploading}
          onClick={() => {
            const file = inputRef.current?.files?.[0];
            if (!file) return;
            const validationError = validateBrandingImage(file);
            if (validationError) {
              setError(validationError);
              return;
            }
            onUpload(file);
          }}
        >
          {isUploading && <Loader2 className="size-4 animate-spin" />}
          Upload
        </Button>
        {imageUrl && (
          <Button type="button" variant="destructive" size="sm" disabled={isRemoving} onClick={onRemove}>
            {isRemoving && <Loader2 className="size-4 animate-spin" />}
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

function BrandingPreviewOnly({ label, imageUrl }: { label: string; imageUrl: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex h-24 w-40 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed MinIO URL, next/image adds nothing here
          <img src={imageUrl} alt={label} className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="size-6 text-foreground-subtle" />
        )}
      </div>
    </div>
  );
}

export function BrandingPanel({
  orgId,
  org,
  canManage,
}: {
  orgId: string;
  org: Organization;
  canManage: boolean;
}) {
  const uploadLogo = useUploadLogo(orgId);
  const deleteLogo = useDeleteLogo(orgId);
  const uploadBanner = useUploadBanner(orgId);
  const deleteBanner = useDeleteBanner(orgId);

  if (!canManage) {
    return (
      <div className="flex flex-wrap gap-6">
        <BrandingPreviewOnly label="Logo" imageUrl={org.logoUrl} />
        <BrandingPreviewOnly label="Banner" imageUrl={org.bannerUrl} />
      </div>
    );
  }

  const mutationError = uploadLogo.error ?? deleteLogo.error ?? uploadBanner.error ?? deleteBanner.error;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-6">
        <BrandingSlot
          label="Logo"
          imageUrl={org.logoUrl}
          onUpload={(file) => {
            const formData = new FormData();
            formData.set('file', file);
            uploadLogo.mutate(formData);
          }}
          onRemove={() => deleteLogo.mutate()}
          isUploading={uploadLogo.isPending}
          isRemoving={deleteLogo.isPending}
        />
        <BrandingSlot
          label="Banner"
          imageUrl={org.bannerUrl}
          onUpload={(file) => {
            const formData = new FormData();
            formData.set('file', file);
            uploadBanner.mutate(formData);
          }}
          onRemove={() => deleteBanner.mutate()}
          isUploading={uploadBanner.isPending}
          isRemoving={deleteBanner.isPending}
        />
      </div>
      {mutationError && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {mutationError instanceof ApiError ? mutationError.message : 'Something went wrong'}
        </p>
      )}
    </div>
  );
}
