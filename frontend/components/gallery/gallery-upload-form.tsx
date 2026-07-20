'use client';

import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUploadPhoto } from '@/features/gallery/use-gallery';
import { validateGalleryImage } from '@/features/gallery/validate-gallery-image';
import { ApiError } from '@/lib/api';

export function GalleryUploadForm({ orgId }: { orgId: string }) {
  const upload = useUploadPhoto(orgId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    const validationError = validateGalleryImage(file);
    if (validationError) {
      setFileError(validationError);
      return;
    }
    setFileError(null);
    const formData = new FormData();
    formData.set('file', file);
    if (caption) formData.set('caption', caption);
    upload.mutate(formData, {
      onSuccess: () => {
        setCaption('');
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg"
        aria-label="Photo file"
        className="text-sm"
        onChange={() => setFileError(null)}
      />
      <Input
        placeholder="Caption (optional)"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        className="w-48"
        aria-label="Caption"
      />
      <Button type="submit" size="sm" disabled={upload.isPending}>
        {upload.isPending && <Loader2 className="size-4 animate-spin" />}
        Upload
      </Button>
      {fileError && <p className="w-full text-sm text-danger">{fileError}</p>}
      {upload.error && (
        <p role="alert" className="w-full text-sm text-danger">
          {upload.error instanceof ApiError ? upload.error.message : 'Something went wrong'}
        </p>
      )}
    </form>
  );
}
