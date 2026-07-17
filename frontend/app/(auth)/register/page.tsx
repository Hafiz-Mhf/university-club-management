'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { registerSchema, type RegisterInput } from '@/features/auth/schemas';
import { useRegister } from '@/features/auth/use-auth';
import { ApiError } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const registerUser = useRegister();
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: '', email: '', password: '', consent: undefined as unknown as true },
  });

  const onSubmit = form.handleSubmit((values) => {
    registerUser.mutate(values, {
      onSuccess: (tokens) => router.replace(tokens.consentStale ? '/consent' : '/'),
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) {
          form.setError('email', { message: 'Email already registered' });
        }
      },
    });
  });

  const topError =
    registerUser.error &&
    !(registerUser.error instanceof ApiError && registerUser.error.status === 409)
      ? 'Something went wrong — please try again'
      : null;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-2xl">Create your account</CardTitle>
        <CardDescription>University Club Management</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {topError && (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {topError}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName" autoComplete="name" {...form.register('fullName')} />
            {form.formState.errors.fullName && (
              <p className="text-sm text-danger">{form.formState.errors.fullName.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
            {form.formState.errors.email && (
              <p className="text-sm text-danger">{form.formState.errors.email.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
            />
            {form.formState.errors.password && (
              <p className="text-sm text-danger">{form.formState.errors.password.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--primary)]"
                {...form.register('consent')}
              />
              <span>
                I agree to the collection and use of my personal data as described in the privacy
                policy (version v1)
              </span>
            </label>
            {form.formState.errors.consent && (
              <p className="text-sm text-danger">{form.formState.errors.consent.message}</p>
            )}
          </div>
          <Button type="submit" disabled={registerUser.isPending} className="mt-2">
            {registerUser.isPending && <Loader2 className="size-4 animate-spin" />}
            Create account
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-foreground-muted">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
