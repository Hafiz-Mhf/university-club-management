# Design System

Distilled from `docs/design-direction-v1.md` and
`docs/superpowers/specs/2026-07-17-frontend-design-system-design.md`. The
application should feel like a modern SaaS platform, not a traditional
university portal — and not a generic AI-template SaaS dashboard either.

**Inspiration:** Notion · Linear · GitHub · Vercel Dashboard · Supabase Dashboard.

**Priorities:** maintainability, accessibility, performance, scalability — over trends.

---

## Design Philosophy — "Warm Editorial Neutral"

Two failure modes to avoid, both common in AI-generated SaaS UI:

1. **Generic dark mode** — pure/near-black `#000000`/`#121212`, cold blue-gray
   (zinc/slate) chrome, a single blue-600 accent used for everything. Reads as
   a template, not a considered product.
2. **Loud/distracting color** — gradients everywhere, saturated backgrounds,
   color used decoratively rather than to communicate.

**The resolution:** color lives in *purpose*, not chrome. The canvas (background,
sidebar, cards, borders) is a **warm neutral** — never cold slate/zinc, never
pure black. Color enters through three deliberate, restrained channels:

- **Per-org branding** — each organization's `primaryColor`/`secondaryColor`
  drives primary buttons and active states within that org's view. This is
  already genuinely colorful per tenant; v1 under-used it visually.
- **Per-domain signature hues** — each feature area (Events, Registrations,
  Attendance, Certificates, Feedback, Analytics) gets one quiet accent color,
  used only on icons, tags, and small indicators — never as a background fill.
  Same device Linear/Notion use for colored tags: reads as colorful, never
  distracting, because it never competes with content.
- **Semantic status colors** — success/warning/danger/info, standard and
  predictable, never repurposed for anything else.

Everything else — surfaces, borders, shadows, typography color — stays
neutral. This is what makes the product feel calm rather than either
sterile-dark or noisy-colorful.

---

## Frontend Stack

Next.js 18 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui · Lucide ·
React Hook Form + Zod · TanStack Table · TanStack Query · Zustand ·
Recharts/Tremor · Motion.

---

## Color Tokens

All tokens are CSS variables (`--color-*`), themed via `[data-theme]`, so
per-org branding can override `--color-primary`/`--color-primary-foreground`
without touching anything else.

### Neutral canvas

| Token | Light | Dark | Notes |
|---|---|---|---|
| `background` | `#FAFAF8` | `#18171B` | warm off-white / warm near-black — never pure `#000`, never cold slate |
| `surface` (card) | `#FFFFFF` | `#211F24` | |
| `surface-secondary` (sidebar) | `#F3F2EE` | `#131216` | sidebar sits one step *darker* than canvas in dark mode — grounds the shell (Linear pattern) |
| `border` | `#E7E5E0` | `#2C2A30` | |
| `foreground` | `#201F1C` | `#F2F1EE` | warm near-black / warm off-white, never pure `#000`/`#FFF` |
| `foreground-muted` | `#6B6862` | `#A8A5A0` | |
| `foreground-subtle` | `#8F8C85` | `#78756F` | placeholder text, disabled labels |

### Platform default brand (org-overridable)

| Token | Value | Notes |
|---|---|---|
| `primary` | `#6E56CF` | calm violet — platform default until an org sets `Organization.primaryColor` |
| `primary-foreground` | `#FFFFFF` | |
| `secondary` | org's `secondaryColor`, falls back to `#5B8DEF` | |

`OrganizationProvider` (frontend) resolves the active org's `primaryColor`/
`secondaryColor` into these two CSS variables at the layout root — every
button/link/active-state in that org's view inherits automatically, no
per-component branching.

### Per-domain signature hues (icons, tags, badges only — never backgrounds)

| Domain | Hue | Light accent | Dark accent | Used on |
|---|---|---|---|---|
| Events | Violet | `#7C5CFC` | `#9B85FF` | event type icons, event status tags |
| Registrations | Blue | `#2F7DE1` | `#5B9CF5` | registration status badges |
| Attendance | Teal | `#0EA5A3` | `#2DD4CE` | QR/scan indicators, attendance state |
| Certificates | Gold | `#B8860B` | `#D9A93E` | certificate icons/badges |
| Feedback / NPS | Rose | `#E1487D` | `#F06B9B` | feedback tags, NPS indicators |
| Analytics | Forest green | `#3F9142` | `#5FB563` | chart accents, growth indicators |
| Files / Minutes / Assets (org ops) | Clay | `#A16A4A` | `#C08A66` | file-type icons, inventory tags |

Each domain hue appears at **10–15% opacity as a tag background** at most
(e.g. `rgba(124,92,252,0.10)` light / `rgba(155,133,255,0.16)` dark behind a
full-opacity icon or text) — never as a full-saturation panel or card
background.

### Semantic status (standard, predictable — never repurposed)

| Token | Light | Dark |
|---|---|---|
| `success` | `#2F9E44` | `#4ADE6E` |
| `warning` | `#C77D11` | `#E0A340` |
| `danger` | `#DC2626` | `#F87171` |
| `info` | `#2F7DE1` (= Registrations blue) | `#5B9CF5` |

Danger stays the industry-standard red — familiarity matters more than
novelty for destructive-action recognition.

---

## Typography

| Role | Font | Why |
|---|---|---|
| Headings / page titles | **Hanken Grotesk** | warmer, rounder terminals than Inter — adds personality without the "every AI template uses this" fatigue of Poppins/Manrope/Space Grotesk |
| Body / UI / data tables | **Inter** | best-in-class small-size legibility, tabular figures for tables/analytics, huge weight range |

```css
@import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
```

```ts
// tailwind config
fontFamily: {
  heading: ['Hanken Grotesk', 'sans-serif'],
  sans: ['Inter', 'sans-serif'],
}
```

| Role | Size | Weight | Font |
|---|---|---|---|
| Page title | 30–36px | 600–700 | heading |
| Section title | 20–24px | 600 | heading |
| Card title | 16–18px | 600 | heading |
| Body | 14–16px | 400–500 | sans |
| Small / caption | 12–13px | 400–500 | sans |
| Table numerals | 14px, tabular-nums | 400–500 | sans |

Line-height 1.5–1.75 body, 1.2–1.3 headings. Line length 60–75ch desktop,
35–60ch mobile.

---

## Spacing, Radius, Shadow, Motion

- **Spacing:** 4px base unit (Tailwind default scale). Section spacing tiers:
  16 / 24 / 32 / 48px by hierarchy.
- **Radius:** 8px (inputs, small controls) · 10px (buttons, cards) · 16px
  (modals, large panels). Consistent — never mixed arbitrarily.
- **Shadow:** soft, 2-layer, **warm-tinted** (not pure black) —
  `0 1px 2px rgba(32,26,20,0.04), 0 4px 12px rgba(32,26,20,0.06)` light;
  dark mode uses a subtle border instead of shadow (shadows don't read well
  on dark surfaces) plus a faint 1px inner highlight on hover.
- **Motion:** 150–300ms micro-interactions, ease-out on enter / ease-in on
  exit, exit ~60–70% of enter duration. Respect `prefers-reduced-motion`.
  Animate `transform`/`opacity` only — never `width`/`height`/`top`/`left`.

---

## Layout Patterns

Three distinct shells — do not force one layout system across all three.

### 1. Admin shell (desktop-first)

- Persistent sidebar (`surface-secondary` token) — org switcher at top,
  nav grouped by domain, each nav icon tinted with its domain hue (this is
  where "colorful but calm" is most visible day-to-day).
  - Top bar: breadcrumbs, org logo/branding, command palette trigger (⌘K),
    user menu.
  - Content area: `max-w-screen-2xl`, KPI cards → tables/charts below,
    per Dashboard Philosophy below.

### 2. Public club page (mobile-first, unauthenticated)

- Org banner + logo hero, upcoming events, gallery, achievements.
- No sidebar — single scrolling column, generous whitespace, org's brand
  color as the only strong accent (this page represents the org, not the
  platform).

### 3. Mobile QR / attendance flow

- Minimal chrome — full-screen scanner view, large high-contrast
  success/fail feedback (color + icon + text, never color alone per
  accessibility baseline), 44×44px minimum touch targets throughout.

---

## Components (shadcn/ui foundation)

Data tables (TanStack Table + shadcn `Table`) · dialogs · drawers/sheets ·
dropdown menus · command palette (⌘K) · calendar · date picker · toast
notifications · tabs · cards · status badges (domain/semantic tokens above).

Use `npx shadcn@latest add dashboard-01`-style blocks as a scaffolding
starting point, not a from-scratch build — then apply this design system's
tokens on top.

---

## Dashboard Philosophy

Every dashboard answers:
1. What is happening?
2. What needs attention?
3. What should I do next?

Include: KPI cards · upcoming events · recent registrations · pending
approvals · activity feed. Each widget's icon/accent uses its domain hue
(e.g. pending registrations widget uses Registrations blue), reinforcing the
per-domain color system at a glance.

---

## Forms

Clear labels · inline validation (on blur, not keystroke) · helpful error
messages placed below the field · loading indicators · success feedback ·
full keyboard accessibility. Break large forms into logical sections with
progressive disclosure.

---

## Tables

Search · filters · sorting · pagination · column visibility · CSV export ·
bulk actions. Tabular figures (`font-variant-numeric: tabular-nums`) for any
numeric column.

---

## Accessibility Baseline

- Contrast: body text ≥4.5:1, large text/UI glyphs ≥3:1 — verified
  independently in both light and dark themes (dark mode is not "invert and
  assume it's fine").
- Color is never the only signal — status always pairs color with an
  icon/text label.
- Visible focus rings (2–4px) on every interactive element; never removed.
- `prefers-reduced-motion` respected everywhere animation is used.
- Touch targets ≥44×44px on all mobile-facing surfaces (QR flow, public page).

---

## Design System Tokens — Summary

Centralize colors · typography · spacing · radius · shadow · motion in one
Tailwind v4 `@theme` block + CSS variables, so per-org theming (`primary`/
`secondary` override) and dark mode (`[data-theme="dark"]`) both compose
cleanly without component-level branching.

---

## Principles

- Clean layouts, minimal clutter
- Clear information hierarchy
- Color communicates purpose, not decoration
- Accessibility first
- Responsive by default — mobile-first for public/QR surfaces, desktop-first
  for admin
