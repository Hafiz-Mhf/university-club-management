'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Sparkles } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateOrg, useOrgs } from '@/features/orgs/use-orgs';
import { ApiError } from '@/lib/api';

const createOrgSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers, and hyphens only'),
});

type CreateOrgInput = z.infer<typeof createOrgSchema>;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function WelcomePage() {
  const router = useRouter();
  const orgs = useOrgs();
  const createOrg = useCreateOrg();
  const form = useForm<CreateOrgInput>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: { name: '', slug: '' },
  });

  const onSubmit = form.handleSubmit((values) => {
    createOrg.mutate(values, {
      onSuccess: (org) => router.replace(`/${org.slug}`),
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) {
          form.setError('slug', { message: 'This slug is already taken' });
        }
      },
    });
  });

  const hasOrgs = (orgs.data?.length ?? 0) > 0;

  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-card">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="size-5 text-primary" />
          </div>
          <CardTitle className="text-2xl">
            {hasOrgs ? 'Create an organization' : 'Welcome!'}
          </CardTitle>
          <CardDescription>
            {hasOrgs
              ? 'Set up another club or society workspace.'
              : "Set up your club's workspace to get started. You'll be its president."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Organization name</Label>
              <Input
                id="name"
                placeholder="Robotics Club"
                {...form.register('name', {
                  onChange: (e) => {
                    if (!form.formState.dirtyFields.slug) {
                      form.setValue('slug', slugify(e.target.value));
                    }
                  },
                })}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-danger">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="slug">URL slug</Label>
              <Input id="slug" placeholder="robotics-club" {...form.register('slug')} />
              <p className="text-xs text-foreground-subtle">
                Used in links: /{form.watch('slug') || 'your-slug'}
              </p>
              {form.formState.errors.slug && (
                <p className="text-sm text-danger">{form.formState.errors.slug.message}</p>
              )}
            </div>
            <Button type="submit" disabled={createOrg.isPending} className="mt-2">
              {createOrg.isPending && <Loader2 className="size-4 animate-spin" />}
              Create organization
            </Button>
            {hasOrgs && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push(`/${orgs.data![0].slug}`)}
              >
                Back to {orgs.data![0].name}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
