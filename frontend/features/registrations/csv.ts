import type { FormField, RegistrationWithUser } from '@/types/api';
import { formatAnswers } from '@/features/registrations/answers';

/** RFC 4180 quoting: wrap everything, double any embedded quote. */
function cell(value: string | number | null | undefined): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/**
 * Committees still owe sponsors and faculty a spreadsheet — exporting one from
 * here is what stops the parallel Google Sheet from being recreated. Columns
 * follow the on-screen table, then one column per registration-form field.
 */
export function registrationsToCsv(
  rows: RegistrationWithUser[],
  fields: FormField[] | undefined,
): string {
  const answerLabels = [...(fields ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((f) => f.label);

  const header = ['Name', 'Student ID', 'Email', 'Programme', 'Status', 'Registered at', ...answerLabels];

  const body = rows.map((r) => {
    const answers = new Map(formatAnswers(r.answers, fields).map((a) => [a.label, a.value]));
    return [
      r.user.fullName,
      r.user.studentId,
      r.user.email,
      r.user.programme,
      r.status,
      new Date(r.createdAt).toISOString(),
      ...answerLabels.map((label) => answers.get(label) ?? ''),
    ];
  });

  return [header, ...body].map((line) => line.map(cell).join(',')).join('\r\n');
}

/** Triggers a client-side download; no server round-trip, no temp storage. */
export function downloadCsv(filename: string, csv: string) {
  // BOM so Excel opens UTF-8 names (e.g. "Nur Aisyah") without mangling them.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** "tech-innovators-hackathon-2026-registrations.csv" */
export function csvFilename(eventTitle: string): string {
  const slug = eventTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'event'}-registrations.csv`;
}
