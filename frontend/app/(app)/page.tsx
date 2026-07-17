import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeToggle } from '@/components/theme/theme-toggle';

// Temporary token showcase — replaced by the real app entry once the shell
// and auth flow land (Tasks 3–5).
const domains = [
  ['Events', 'bg-domain-events'],
  ['Registrations', 'bg-domain-registrations'],
  ['Attendance', 'bg-domain-attendance'],
  ['Certificates', 'bg-domain-certificates'],
  ['Feedback', 'bg-domain-feedback'],
  ['Analytics', 'bg-domain-analytics'],
  ['Ops', 'bg-domain-ops'],
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Warm Editorial Neutral</h1>
        <ThemeToggle />
      </div>
      <p className="text-foreground-muted">
        Token smoke test: warm canvas, Hanken Grotesk headings, Inter body,
        domain hues on small elements only.
      </p>
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>Domain hues</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {domains.map(([label, cls]) => (
            <Badge key={label} variant="outline" className="gap-1.5">
              <span className={`size-2 rounded-full ${cls}`} />
              {label}
            </Badge>
          ))}
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button>Primary action</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
      </div>
    </main>
  );
}
