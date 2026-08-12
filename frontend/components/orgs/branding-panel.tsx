'use client';

import { useEffect, useRef, useState } from 'react';
import { ImageIcon, Loader2, Upload } from 'lucide-react';
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

function Frame({
  imageUrl,
  alt,
  className,
}: {
  imageUrl: string | null | undefined;
  alt: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center overflow-hidden rounded-md border border-border bg-muted ${className ?? ''}`}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed MinIO URL (or a local object URL), next/image adds nothing here
        <img src={imageUrl} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <ImageIcon className="size-6 text-foreground-subtle" aria-hidden />
      )}
    </div>
  );
}

function BrandingSlot({
  label,
  imageUrl,
  frameClass,
  onUpload,
  onRemove,
  isUploading,
  isRemoving,
}: {
  label: string;
  imageUrl: string | null | undefined;
  frameClass: string;
  onUpload: (file: File) => void;
  onRemove: () => void;
  isUploading: boolean;
  isRemoving: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null);

  // The preview URL is created where the file is picked, so this effect only
  // has to hand it back — object URLs leak until revoked.
  useEffect(() => {
    const url = pending?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [pending?.url]);

  const clear = () => {
    setPending(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>

      {/* Shows what you picked before you commit it — the old flow uploaded
          blind and only validated after you pressed the button. */}
      <Frame imageUrl={pending?.url ?? imageUrl} alt={label} className={frameClass} />

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label={`${label} file`}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          if (!file) return clear();
          const validationError = validateBrandingImage(file);
          setError(validationError);
          setPending(validationError ? null : { file, url: URL.createObjectURL(file) });
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
          <Upload className="size-3.5" />
          {pending || imageUrl ? 'Choose another' : 'Choose image'}
        </Button>
        {pending && (
          <Button
            type="button"
            size="sm"
            disabled={isUploading}
            onClick={() => {
              onUpload(pending.file);
              clear();
            }}
          >
            {isUploading && <Loader2 className="size-4 animate-spin" />}
            Save {label.toLowerCase()}
          </Button>
        )}
        {pending && (
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            Cancel
          </Button>
        )}
        {!pending && imageUrl && (
          <Button type="button" variant="destructive" size="sm" disabled={isRemoving} onClick={onRemove}>
            {isRemoving && <Loader2 className="size-4 animate-spin" />}
            Remove
          </Button>
        )}
      </div>

      <p className="text-xs text-foreground-subtle">
        {pending ? `${pending.file.name} — not saved yet` : 'PNG, JPEG or WebP · up to 2MB'}
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function BrandingPreviewOnly({
  label,
  imageUrl,
  frameClass,
}: {
  label: string;
  imageUrl: string | null | undefined;
  frameClass: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <Frame imageUrl={imageUrl} alt={label} className={frameClass} />
    </div>
  );
}

// Frames match the aspect ratio each image is actually rendered at on the
// public club page, so the preview isn't lying about the crop.
const LOGO_FRAME = 'size-24';
const BANNER_FRAME = 'h-24 w-full sm:w-80';

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
        <BrandingPreviewOnly label="Logo" imageUrl={org.logoUrl} frameClass={LOGO_FRAME} />
        <BrandingPreviewOnly label="Banner" imageUrl={org.bannerUrl} frameClass={BANNER_FRAME} />
      </div>
    );
  }

  const mutationError = uploadLogo.error ?? deleteLogo.error ?? uploadBanner.error ?? deleteBanner.error;

  const upload = (mutation: { mutate: (fd: FormData) => void }) => (file: File) => {
    const formData = new FormData();
    formData.set('file', file);
    mutation.mutate(formData);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
        <BrandingSlot
          label="Logo"
          imageUrl={org.logoUrl}
          frameClass={LOGO_FRAME}
          onUpload={upload(uploadLogo)}
          onRemove={() => deleteLogo.mutate()}
          isUploading={uploadLogo.isPending}
          isRemoving={deleteLogo.isPending}
        />
        <BrandingSlot
          label="Banner"
          imageUrl={org.bannerUrl}
          frameClass={BANNER_FRAME}
          onUpload={upload(uploadBanner)}
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
