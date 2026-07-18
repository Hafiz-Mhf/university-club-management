import type { FormField, Registration } from '@/types/api';

export function formatAnswers(
  answers: Registration['answers'],
  fields: FormField[] | undefined,
): { label: string; value: string }[] {
  if (!answers) return [];

  const orderByLabel = new Map((fields ?? []).map((f) => [f.label, f.order]));
  const keys = Object.keys(answers).sort((a, b) => {
    const orderA = orderByLabel.get(a) ?? Number.MAX_SAFE_INTEGER;
    const orderB = orderByLabel.get(b) ?? Number.MAX_SAFE_INTEGER;
    return orderA - orderB;
  });

  return keys.map((key) => {
    const raw = answers[key];
    const value = Array.isArray(raw) ? raw.join(', ') : raw;
    return { label: key, value };
  });
}
