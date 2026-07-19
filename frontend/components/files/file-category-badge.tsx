import { Badge } from '@/components/ui/badge';
import type { FileCategory } from '@/types/api';

const LABEL: Record<FileCategory, string> = {
  SOP: 'SOP',
  REPORT: 'Report',
  FINANCIAL: 'Financial',
  MEETING: 'Meeting',
  OTHER: 'Other',
};

// Plain outline, no color-coding — category isn't a success/failure signal,
// and the Workspace domain hue stays on the nav icon only.
export function FileCategoryBadge({ category }: { category: FileCategory }) {
  return <Badge variant="outline">{LABEL[category]}</Badge>;
}
