import { z } from 'zod';

// Mirrors backend DTO rules (LoginDto / RegisterDto) so most validation
// errors never leave the client.

export const loginSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  fullName: z.string().min(1, 'Your name is required'),
  email: z.email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  consent: z.literal(true, 'You must agree to the privacy policy to create an account'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
