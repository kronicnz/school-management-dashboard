# AGENTS.md

## Purpose
This repository is a production-style school management SPA. The goal is to modernize the interface, not rebuild the app.

## Core principle
**Do not rebuild the application. Rebuild its interface.**

Preserve:
- business logic
- data models
- API/service contracts
- authentication and authorization
- routing and deep links
- validation and calculations
- existing workflows

## Current stack
- Vite
- React 19
- TypeScript
- Tailwind CSS v4
- shadcn/ui-style primitives
- Supabase
- React Router
- Lucide icons

## Repo conventions
- Use the existing source layout under `src/`.
- Use `@/*` and `#/*` aliases already configured for `src/*`.
- Keep new code aligned with existing patterns in:
  - `src/lib/api/supabaseApi.ts`
  - `src/components/ui/*`
  - `src/components/layout/*`
  - `src/pages/*`

## Source-of-truth rules
- Treat the current application as the source of truth.
- Do not invent roles, KPIs, workflows, financial values, or business rules.
- Verify behavior against existing code and Supabase schema before changing presentation.

## Design-system-first approach
The UI already uses semantic CSS variables in `src/index.css`. Extend that system instead of scattering arbitrary values.

Prefer semantic tokens for:
- background / surface / elevated surface
- border / muted border
- text / muted text
- primary / accent
- success / warning / destructive / info

Keep:
- spacing consistent
- radius consistent
- shadows restrained
- surfaces clearly layered

Avoid:
- random colors
- excessive gradients
- excessive shadows
- decorative UI that weakens clarity

## Reusable UI primitives
Prefer existing shared components before creating new ones:
- `Card`
- `DataTable`
- `Dialog`
- `FormField`
- `Input`
- `Select`
- `Textarea`
- `Button`
- `Table`
- `TableBadge`
- `TableAvatar`
- `StatisticCard`
- `StatisticGrid`
- `ThemeToggle`

## Badge and table rules
- Use `TableBadge` for status, role, and similar badges.
- Keep tables scanable and dense without becoming cramped.
- Preserve sorting, filtering, pagination, selection, and row actions where they already exist.
- Keep `DataTable` as the shared table pattern unless there is a strong reason not to.

## Routing and authorization
Routing is defined in `src/App.tsx`.

Preserve:
- existing route paths
- protected-route behavior
- redirects
- role-based route access
- unauthorized toast/redirect behavior

Current tier model:
- `minimal_access`
- `operational_staff`
- `leadership`
- `it_admin`

Respect the existing tier precedence and page visibility rules in `src/lib/role-tier.ts`.

## Authentication
Authentication is managed through:
- `src/context/AuthContext.tsx`
- `src/lib/supabaseClient.ts`
- `src/lib/mock-auth.ts`

Preserve:
- login/logout flow
- session handling
- Google OAuth behavior
- mock auth support for UI testing
- role-based auth state

Do not break the mock personas used for UI validation.

## Supabase/data boundary
Use `src/lib/api/supabaseApi.ts` as the API boundary for app data access.

Rules:
- Do not bypass this boundary casually.
- Do not change queries, RPC usage, or schemas unless the task explicitly requires it.
- Preserve server-side permission boundaries.
- Preserve existing RPC-backed behavior where present.

## Dashboard rules
The dashboard is role-aware and stats-driven.

Rules:
- Use `fetchDashboardStatsForTier(tier)` for dashboard metrics.
- Do not invent metrics.
- Do not surface data the tier should not see.
- Keep dashboard cards, summaries, and charts aligned with actual data.
- Preserve tier-specific presentation:
  - leadership
  - operational staff
  - IT admin
  - minimal access

If a desirable KPI is not supported by existing data, document the limitation instead of fabricating it.

## Financial data
- Use NZD only.
- Do not introduce other currencies unless the app already requires multi-currency support.
- Do not invent financial figures.

## Responsive design
Design mobile-first, then scale up.

Requirements:
- work across mobile, tablet, laptop, desktop
- use grid/flex/responsive Tailwind utilities
- avoid fixed-width layouts for major screens
- avoid unnecessary fixed heights
- prevent horizontal overflow
- provide intentional table behavior on small screens

For dense tables, use one or more of:
- horizontal scrolling
- condensed columns
- stacked rows/cards
- detail drawers/sheets
- alternate mobile representations

## Accessibility
Maintain or improve accessibility.

Require:
- semantic HTML
- keyboard support
- visible focus states
- good contrast
- accessible labels
- meaningful button text
- clear form errors
- status not conveyed by color alone

## Forms, dialogs, and interactions
- Preserve validation, submission behavior, and error handling.
- Prefer the appropriate interaction pattern: dialog, sheet, drawer, or inline edit.
- Do not convert every action into a modal.
- Keep confirmation requirements intact.

## Charts and KPI visuals
- Use charts only when they support a decision or explanation.
- Match the chart type to the data.
- Label clearly.
- Avoid decorative charts with no value.
- Keep accessibility in mind.

## Incremental migration
This is an incremental redesign, not a rewrite.

Work in focused stages:
1. inspect existing implementation
2. preserve behavior
3. modernize presentation
4. validate
5. report remaining work

Prefer module-by-module migration:
- application shell
- dashboard
- students
- staff
- assets
- tickets
- incidents
- attendance
- classes
- admin/accounting areas as applicable

Do not redesign all modules in one uncontrolled task.

## Specialist skills
Use the specialist skills sequentially, not all at once:

1. `ui-ux-pro-max`
2. `kpi-dashboard-design`
3. `tailwindcss-advanced-layouts`
4. `shadcn`

Use them as follows:
- `ui-ux-pro-max`: visual direction, UX hierarchy, typography, color, composition
- `kpi-dashboard-design`: dashboard metrics, KPI hierarchy, trend logic
- `tailwindcss-advanced-layouts`: responsive layout, grid/flex architecture
- `shadcn`: reusable primitives, tables, dialogs, forms, navigation components

## Validation
Use existing scripts only.

Current scripts:
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run test`
- `npm run preview`

Validate with the smallest relevant set:
- TypeScript/build
- lint
- tests when relevant
- route/auth/data flow after changes
- responsive and accessibility checks for UI work

Do not claim validation if it was not actually performed.

## Dependency discipline
- Do not install packages unless necessary.
- Prefer the existing stack first.
- Reuse current utilities and components before adding new dependencies.

## Git discipline
- Make focused commits after meaningful completed stages.
- Avoid destructive git commands.
- Do not overwrite user changes.
- Keep work incremental and reviewable.

## Continuation protocol
If work is resumed after a context limit or interrupted session:
1. inspect current repo state
2. inspect changed files
3. determine what is already complete
4. determine what remains
5. preserve correct prior work
6. continue from the current state
7. report completed and remaining work before proceeding

## Completion report
At the end of an implementation task, report:
- Completed
- Preserved
- Validation
- Files changed
- Remaining
- Risks

## Final rule
**Preserve the application's behaviour. Modernise its interface. Establish a reusable design system. Migrate the existing UI incrementally.**