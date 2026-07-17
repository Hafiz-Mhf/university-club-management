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
import { loginSchema, type LoginInput } from '@/features/auth/schemas';
import { useLogin } from '@/features/auth/use-auth';
import { ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit((values) => {
    login.mutate(values, {
      onSuccess: (tokens) => router.replace(tokens.consentStale ? '/consent' : '/'),
    });
  });

  const topError =
    login.error instanceof ApiError && login.error.status === 401
      ? 'Invalid email or password'
      : login.error
        ? 'Something went wrong — please try again'
        : null;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-2xl">Sign in</CardTitle>
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
              autoComplete="current-password"
              {...form.register('password')}
            />
            {form.formState.errors.password && (
              <p className="text-sm text-danger">{form.formState.errors.password.message}</p>
            )}
          </div>
          <Button type="submit" disabled={login.isPending} className="mt-2">
            {login.isPending && <Loader2 className="size-4 animate-spin" />}
            Sign in
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-foreground-muted">
          No account yet?{' '}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create one
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
