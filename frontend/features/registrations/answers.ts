import type { FormField, Registration } from '@/types/api';

export function formatAnswers(
  answers: Registration['answers'],
  fields: FormField[] | undefined,
): { label: string; value: string }[] {
  if (!answers) return [];

  // Registration answers are keyed by field id (backend's answers shape),
  // not by label — look up each key's display label and sort order from
  // the current form; a key with no matching field (form since deleted or
  // changed) falls back to showing its raw key as the label.
  const fieldById = new Map((fields ?? []).filter((f) => f.id).map((f) => [f.id as string, f]));
  const keys = Object.keys(answers).sort((a, b) => {
    const orderA = fieldById.get(a)?.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = fieldById.get(b)?.order ?? Number.MAX_SAFE_INTEGER;
    return orderA - orderB;
  });

  return keys.map((key) => {
    const raw = answers[key];
    const value = Array.isArray(raw) ? raw.join(', ') : raw;
    const label = fieldById.get(key)?.label ?? key;
    return { label, value };
  });
}
