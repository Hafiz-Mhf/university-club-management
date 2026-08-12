'use client';

import { useFieldArray, useFormContext, type FieldErrors } from 'react-hook-form';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { OrgProfileFormValues } from '@/features/orgs/profile-schema';

export function AdvisorsFields({ errors }: { errors: FieldErrors<OrgProfileFormValues> }) {
  const { control, register } = useFormContext<OrgProfileFormValues>();
  const advisors = useFieldArray({ control, name: 'advisors' });

  return (
    <div className="flex flex-col gap-2">
      <Label>Advisors</Label>
      {advisors.fields.map((f, index) => (
        <div key={f.id} className="flex items-start gap-2">
          <Input placeholder="Advisor name" className="flex-1" {...register(`advisors.${index}.name`)} />
          <Button type="button" variant="ghost" size="icon" onClick={() => advisors.remove(index)} aria-label="Remove advisor">
            <X className="size-4" />
          </Button>
        </div>
      ))}
      {errors.advisors && <p className="text-sm text-danger">Each advisor needs a name.</p>}
      <Button type="button" variant="secondary" className="w-fit" onClick={() => advisors.append({ name: '' })}>
        <Plus className="size-4" />
        Add advisor
      </Button>
    </div>
  );
}
