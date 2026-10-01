# UI contract

The rules every screen in this app is held to. It describes the interface, not the
business logic: routes, roles, data access and status lifecycles are defined in
`AGENTS.md` and are unchanged by anything here.

Three of these rules are enforced by tests rather than review, so a violation fails the
build rather than shipping:

| Rule | Enforced by |
| --- | --- |
| No raw Tailwind palette class reaches a component | `src/components/ui/palette-ratchet.test.ts` |
| Every status colour clears AA as text on every surface, in both themes | `src/components/ui/contrast.test.ts` |
| A KPI value never wraps, at any width | `src/components/ui/statistic-fit.test.ts` |

## Colour

All colour comes from the semantic tokens in `src/index.css`. Both theme blocks declare
the same token names; a component never names a theme.

- **Surfaces**, in nesting order: `--color-canvas` (page) → `--color-surface` (card) →
  `--color-surface-elevated` (popover, dialog) → `--color-surface-soft` (recessed:
  nested block, KPI icon tile, empty state) and `--color-surface-muted` (a stronger
  fill, e.g. a tab count).
- **Fills over a surface**: `--color-row` (a hairline wash) and `--color-row-hover`
  (interactive hover). These replaced `bg-white/[0.02]` and `bg-white/5`; do not
  reintroduce raw white utilities, and do not add another alpha literal.
- **Text**: `--color-text` (primary), `--color-muted` (secondary), `--color-subtle`
  (tertiary metadata; clears AA on all three surfaces).
- **Lines**: `--color-border` (hairline), `--color-border-muted` (inner divider).
- **Status**: `--color-success`, `--color-warning`, `--color-information`,
  `--color-pending`, `--color-overdue`, `--color-completed`, `--color-inactive`,
  `--color-destructive`. Status is named through `TableBadge` and `StatisticCard`
  `tone`, never through a colour class.
- **Intent**: `--color-accent-strong` (primary fill), `--color-danger-fill` and
  `--color-danger-fill-hover` (destructive fill). Each carries `--color-button-text`.
- **Focus**: `--color-ring`, always as `focus-visible:ring-2` on the interactive
  element itself.

To tint a border or a wash derived from a status colour, use
`color-mix(in srgb, var(--color-<token>) <n>%, transparent)`. Never introduce a raw
`rgb()`, hex, or palette step.

## Type

Five sizes, and no others.

| Tier | Size | Use |
| --- | --- | --- |
| Page title | `1.35 / 1.55 / 1.7rem`, `font-semibold`, `tracking-tight` | `PageHeader` only, and only in the app header |
| Section title | `text-base`, `font-semibold` | `CardTitle`, wizard step heading |
| Body | `text-sm`, `leading-6` | prose, table cell content, descriptions |
| Metadata | `text-xs`, `leading-5` | timestamps, counts, helper text |
| Micro-label | `text-xs`, `font-semibold`, `uppercase`, `tracking-[0.16em]` | field group labels, `StatisticCard` labels |

`text-[10px]` and `text-[11px]` are not in the scale. KPI values step their own size
down instead of shrinking, and never wrap (`src/components/ui/statistic-scale.ts`).
Numbers that must align in a column or a stat tile are `tabular-nums`.

**One page title per route.** `AppHeader` renders the title, the breadcrumb and the
active role for every route inside the shell. A page must not render its own `h1`; if
it needs a label for the current view (the queue filter, the active tab), that is an
`h2` at section-title tier.

## Space, radius, elevation

- Spacing is the Tailwind step scale. Page gutters: `px-3 sm:px-4 lg:px-8`; vertical
  rhythm between page regions: `space-y-6`; inside a card: `p-4` to `p-6`.
- Radius: `rounded-lg` for controls, `rounded-xl` for inner tiles and inputs,
  `rounded-2xl` for cards, panels and skeletons, `rounded-full` for badges and
  avatars only. `rounded-3xl` does not appear in a product surface.
- Elevation is carried by the surface ladder plus a hairline border. `Card` and
  `Table` own their shadow; a page-level `shadow-xl` or `shadow-2xl` is out of
  contract. Overlays (`Dialog`, `Sheet`, popovers) are the one place a strong shadow
  is correct, because they are genuinely above the page.
- No decorative gradients, glow orbs, `blur-*` decoration, or `backdrop-blur` on
  content surfaces. Translucency is allowed where a surface is genuinely layered:
  the sticky app header, an open overlay, and a drag target.

## Motion

Transitions are `transition-colors duration-150` with a `motion-reduce:transition-none`
counterpart. There are no scale, translate or rotate effects, no `transition-all`, and
no decorative loop; a spinner is the only always-on animation. The one exception is
data arriving: a skeleton may pulse, and it must stand still under reduced motion.

## Components

Reach for the primitive before writing markup. If the primitive genuinely cannot express
the case, extend the primitive rather than inlining a variant.

| Need | Primitive |
| --- | --- |
| Container, section, KPI | `Card`, `CardHeader`, `CardTitle`, `CardContent`, `StatisticCard`, `StatisticGrid` |
| Tabular data | `DataTable`, `Table`, `TableBadge`, `TableAvatar` |
| Overlay | `Dialog`, `Sheet` |
| Form control | `Input`, `Select`, `Textarea`, `FormField`, `Button` |
| Status and feedback | `TableBadge`, `Toast`, `Spinner`, `EmptyState`, `Skeleton` (`SkeletonHeading`, `SkeletonStats`, `SkeletonPanel`) |
| Page framing | `AppShell`, `AppHeader`, `AppSidebar`, `PageHeader` |

A hand-rolled input, badge, skeleton, or empty state is a defect, not a variation. The
duplicated instances that existed in dashboard, finance, incidents, admin, assets and
sandbox have been folded into the primitives listed above; the comment in each primitive
records what it replaced and why.

## State matrix

Every surface that can be empty, slow, or broken must show a real state.

| State | Requirement |
| --- | --- |
| Loading | `Skeleton*` sized to the content it replaces, inside a `role="status" aria-busy="true"` container with an `sr-only` announcement. No layout shift when content lands. |
| Empty | `EmptyState`. Name what is empty; include the action that fills it when the viewer has permission. |
| Error | Name the failure and offer retry. A toast alone is not sufficient for a failed load. |
| Success | Toast plus the settled list, not an optimistic row that silently disagrees with the server. |
| Disabled | `disabled` on the control, with the reason available in text or `title`. |
| Permission | A read-only or out-of-tier surface states what it will not do. The server still refuses the write; the UI never implies otherwise. |

## Interaction and accessibility

- Every control has a hover state, a `focus-visible` ring, and a disabled state.
- Tabs are a `role="tablist"` with `role="tab"`, `aria-selected`, `aria-controls`,
  roving `tabIndex`, and a matching `role="tabpanel"`. A row of buttons that looks like
  tabs is not a tablist.
- Icon-only controls carry `aria-label`; decorative icons next to a label are
  `aria-hidden`.
- Hit targets are at least 24×24 CSS px (WCAG 2.2, 2.5.8), and at least 44px for a
  primary mobile action.
- Status is never colour alone: a badge carries its label.
- Motion respects `prefers-reduced-motion`.

## Responsive

Mobile-first, verified at 360 / 390 / 768 / 1440.

- No horizontal overflow at any width; `body` clips, content must not.
- `StatisticGrid` holds two columns down to 360px because the value steps its size
  rather than truncating.
- Dense tables scroll horizontally inside their `Table` wrapper, or move detail into a
  sheet on small screens. No fixed widths on major regions, no fixed heights where
  content varies.
- Toolbar rows wrap; a page action row is right-aligned and wraps rather than pushing
  the primary action off-screen.

## Data honesty

- Metrics come from the existing queries and RPCs. No invented KPI, no placeholder
  value standing in for real data.
- Currency is NZD.
- A status is a `TableBadge`. Nothing pulses to imply liveness the app does not have.
- Copy describes what the screen does for this viewer. It does not narrate the layout
  ("arranged for a three-column rhythm") and it does not claim a system state the data
  does not report.
