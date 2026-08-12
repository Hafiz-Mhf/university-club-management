'use client';

import { useFieldArray, useFormContext, type FieldErrors } from 'react-hook-form';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { OrgProfileFormValues } from '@/features/orgs/profile-schema';

export function SocialLinksFields({ errors }: { errors: FieldErrors<OrgProfileFormValues> }) {
  const { control, register } = useFormContext<OrgProfileFormValues>();
  const links = useFieldArray({ control, name: 'socialLinks' });

  return (
    <div className="flex flex-col gap-2">
      <Label>Social links</Label>
      {links.fields.map((f, index) => (
        // Three controls on one row squeezed the URL field to ~110px on a
        // phone. Stack until there's room for them to sit side by side.
        <div key={f.id} className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <Input placeholder="Platform (e.g. instagram)" className="sm:w-40" {...register(`socialLinks.${index}.key`)} />
          <div className="flex flex-1 items-start gap-2">
            <Input placeholder="URL" className="flex-1" {...register(`socialLinks.${index}.value`)} />
            <Button type="button" variant="ghost" size="icon" onClick={() => links.remove(index)} aria-label="Remove social link">
              <X className="size-4" />
            </Button>
          </div>
        </div>
      ))}
      {errors.socialLinks && (
        <p className="text-sm text-danger">Each social link needs a platform and a URL.</p>
      )}
      <Button type="button" variant="secondary" className="w-fit" onClick={() => links.append({ key: '', value: '' })}>
        <Plus className="size-4" />
        Add social link
      </Button>
    </div>
  );
}
