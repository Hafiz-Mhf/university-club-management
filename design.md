# Design System

Distilled from `docs/design-direction-v1.md`. The application should feel like a
modern SaaS platform, not a traditional university portal.

**Inspiration:** Notion · Linear · GitHub · Vercel Dashboard · Supabase Dashboard.

**Priorities:** maintainability, accessibility, performance, scalability — over trends.

---

## Frontend Stack

Next.js 18 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui · Lucide ·
React Hook Form + Zod · TanStack Table · TanStack Query · Zustand ·
Recharts/Tremor · Motion.

---

## Layout

- Top navigation
- Persistent sidebar (Zinc-900)
- Dashboard content area
- Analytics cards · recent activity · upcoming events

Desktop-first for administration. Mobile-optimized for: QR attendance,
participant lookup, basic event management.

---

## Color

| Token | Value |
|-------|-------|
| Background | White / Zinc-50 |
| Sidebar | Zinc-900 |
| Primary | Blue-600 |
| Success | Emerald |
| Warning | Amber |
| Danger | Red |

- **Dark mode supported from the beginning.**
- Each organization can customize: primary color, logo, banner.

---

## Typography

Fonts: **Geist** or **Inter**.

| Role | Size |
|------|------|
| Page title | 30–36px |
| Section title | 20–24px |
| Body | 14–16px |
| Small text | 12–13px |

---

## Components (shadcn/ui foundation)

Data tables · dialogs · drawers/sheets · dropdown menus · command palette ·
calendar · date picker · toast notifications · tabs · cards.

---

## Dashboard Philosophy

Every dashboard answers:
1. What is happening?
2. What needs attention?
3. What should I do next?

Include: KPI cards · upcoming events · recent registrations · pending approvals ·
activity feed.

---

## Forms

Clear labels · inline validation · helpful error messages · loading indicators ·
success feedback · keyboard accessibility. Break large forms into logical
sections.

---

## Tables

Search · filters · sorting · pagination · column visibility · CSV export ·
bulk actions.

---

## Design System Tokens

Standardize: colors · typography · spacing · border radius · shadows ·
animation durations. Keep them centralized so per-org theming overrides cleanly.

---

## Principles

- Clean layouts, minimal clutter
- Clear information hierarchy
- Accessibility first
- Responsive by default
