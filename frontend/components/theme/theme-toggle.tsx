'use client';

import { Moon, Sun, SunMoon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme, type ThemePreference } from '@/hooks/use-theme';

const NEXT: Record<ThemePreference, ThemePreference> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

const LABEL: Record<ThemePreference, string> = {
  light: 'Theme: light',
  dark: 'Theme: dark',
  system: 'Theme: follows system',
};

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const Icon = preference === 'light' ? Sun : preference === 'dark' ? Moon : SunMoon;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={LABEL[preference]}
      title={LABEL[preference]}
      onClick={() => setPreference(NEXT[preference])}
    >
      <Icon className="size-4" />
    </Button>
  );
}
