# Role Permissions Plan

## Goal
Move the app to additive role-based authorization with multiple active roles per user, while keeping the existing shell/navigation/dashboards stable and preserving current ticket, incident, and admin workflows.

## Decisions Locked
- A user can hold multiple active roles.
- Authorization is the union of all assigned roles.
- `site_admin` is a distinct first-class role and overrides all other checks.
- The shell still resolves to one presentation tier/subtype for header, nav, and dashboard framing.
- No dedicated finance route/module is added in this change; finance access is limited to existing finance summary/stat surfaces.

## Role Matrix
- `site_admin`: full read/write access across the entire application.
- `finance_admin`: full read/write access to finance modules/statistics.
- `finance_read_only`: read-only access to finance modules/statistics.
- `board_member`: read-only access to finance reports/statistics only.
- `it_admin`: full read/write access to ICT ticket modules; view all ICT statistics; assign ICT tickets to IT staff; create R&M tickets; view own R&M tickets and statistics.
- `it_staff`: create ICT tickets; edit assigned ICT tickets; view own ICT tickets and statistics.
- `property_manager`: full read/write access to R&M ticket modules; view all R&M statistics; assign R&M tickets to Property Staff; create R&M tickets; view own R&M tickets and statistics.
- `property_staff`: create R&M tickets; edit assigned R&M tickets; view own R&M tickets and statistics.
- `teacher`: read-only view of students assigned to their class; read/write access to their own ICT tickets, R&M tickets, and incidents, plus related statistics.
- `counsellor`: full read/write access to incidents and incident statistics.

## Gaps To Fix In The Concept
- The `Property Manager` bullet needs the missing assignment target filled in as `Property Staff`.
- “Incidence tickets” should be treated as `Incidents`.
- Finance access needs a split between full finance administration, finance read-only users, and board-level finance reporting.
- The current app uses one resolved tier; that must remain only a presentation concern, not the source of authorization.

## Implementation Steps
1. Expand the role vocabulary in `src/lib/role-tier.ts` to include the new role strings and a deterministic shell-resolution helper for multi-role users.
2. Replace single-tier authorization checks with additive role predicates that operate on the normalized role set.
3. Keep the current tier/subtype shell framing, but derive it from the highest-priority matching role for display only.
4. Update route guards in `src/App.tsx` so access is driven by role capabilities rather than a single tier.
5. Update `src/components/layout/navigation.ts` so nav visibility follows the new capability model and finance users do not lose access when they also hold operational roles.
6. Update dashboard framing in `src/pages/Dashboard.tsx` and `src/components/dashboard/DashboardOverview.tsx` so finance users land on the same finance-first summary copy already present for `finance_admin`.
7. Update ticket and incident page guards in `src/pages/Tickets.tsx` and `src/pages/Incidents.tsx` to use role capabilities for create/view/edit/assign rules, while preserving existing row-level ownership and scope checks.
8. Update admin/persona fixtures in `src/lib/mock-auth.ts` and any role-assignment UI in `src/pages/Admin.tsx` so multiple roles can be assigned and tested.
9. Audit `src/lib/api/supabaseApi.ts` for hardcoded role checks that still assume one primary role, then convert them to additive checks without changing existing RPC/data contracts unless required.
10. Verify no schema migration is needed for `user_roles.role` because it already stores arbitrary role strings; only backend role lists or policies need changes if they hardcode the old set.

## Data Flow
- `user_roles` remains the source of truth for all active role assignments.
- Auth context fetches the full active role list and exposes it unchanged to the UI.
- Authorization helpers derive capabilities from the full role list.
- Presentation helpers derive one shell tier/subtype for navigation and copy only.

## Failure Modes To Guard Against
- A multi-role user must not lose access to a module because a lower-priority presentation tier was chosen.
- `site_admin` must bypass all module and route gates.
- Read-only finance users must not gain write buttons through shared dashboard or navigation components.
- Teacher-scoped incident and ticket actions must keep their current ownership/scope restrictions.

## Validation
- Run `npm run build`.
- Run `npm run lint`.
- Smoke test with mock personas covering: `site_admin`, `finance_admin`, `finance_read_only`, `board_member`, `it_admin`, `it_staff`, `property_manager`, `property_staff`, `teacher`, and `counsellor`.
- Verify route visibility, dashboard framing, and create/edit/assign buttons for ICT, R&M, and incidents under mixed-role users.

## Out Of Scope
- New finance routes or a separate finance module.
- Backend schema redesign for roles.
- Rewriting existing ticket/incident workflows beyond authorization and visibility changes.
