'use client';

import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUploadFile } from '@/features/files/use-files';
import { validateUploadFile } from '@/features/files/validate-upload-file';
import type { FileCategory } from '@/types/api';
import { ApiError } from '@/lib/api';

const CATEGORIES: FileCategory[] = ['SOP', 'REPORT', 'FINANCIAL', 'MEETING', 'OTHER'];

export function UploadFileDialog({
  orgId,
  open,
  onOpenChange,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const upload = useUploadFile(orgId);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<FileCategory>('OTHER');
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setTitle('');
    setCategory('OTHER');
    setFileError(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload file</DialogTitle>
          <DialogDescription>
            PDF, Word, Excel, PowerPoint, PNG, or JPEG — up to 20MB.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const file = fileInputRef.current?.files?.[0];
            if (!title || !file) return;
            const validationError = validateUploadFile(file);
            if (validationError) {
              setFileError(validationError);
              return;
            }
            setFileError(null);
            setUploadError(null);
            const formData = new FormData();
            formData.set('title', title);
            formData.set('category', category);
            formData.set('file', file);
            upload.mutate(formData, {
              onSuccess: () => {
                reset();
                onOpenChange(false);
              },
              onError: (err) => {
                setUploadError(err instanceof ApiError ? err.message : 'Something went wrong');
              },
            });
          }}
          className="flex flex-col gap-3"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            aria-label="Title"
            className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as FileCategory)}
            aria-label="Category"
            className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.docx,.xlsx,.pptx,image/png,image/jpeg"
            aria-label="File"
            className="text-sm"
          />
          {fileError && (
            <p role="alert" className="text-sm text-danger">
              {fileError}
            </p>
          )}
          {uploadError && (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {uploadError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={upload.isPending || !title}>
              {upload.isPending && <Loader2 className="size-4 animate-spin" />}
              Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
