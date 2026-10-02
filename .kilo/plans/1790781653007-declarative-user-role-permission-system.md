# Declarative User Role & Permission System

## Context

The app already has a real role store — `public.user_roles` (date-windowed, `profile_id` FK, CHECK-constrained to 10 roles) — but authorisation is hardcoded as role checks in two layers that must stay in sync:

- Client: `src/lib/role-tier.ts` (4 `RoleTier`s + 8 `OperationalSubtype`s), plus inline checks in `src/pages/Tickets.tsx:268-275`, `src/pages/Incidents.tsx:136`, `src/pages/Finance.tsx:16`, `src/lib/api/supabaseApi.ts:818,980`.
- Database: RLS policies + `SECURITY DEFINER` helpers `is_it_admin`, `is_it_staff`, `is_access_admin`, `is_counsellor_or_leadership`, `is_rm_admin`, `is_rm_property_manager`, `is_rm_leadership`, `is_rm_operator`, `can_access_ticket`, `can_access_rm_ticket`, `finance_can_view`, `finance_can_manage`.

Known drift that motivates this work:
- `leadership` tier is unreachable dead code (`getResolvedRoleTier` can never return it), yet 12+ branches test it, including `isReadOnlyLeadership` (`Tickets.tsx:273`).
- `is_rm_admin` is `it_admin` only, but `Tickets.tsx:274` treats `site_admin` as admin — a `site_admin` sees the Assign UI and the RPC raises.
- The same 3-role "sensitive" list is written out 3 times.
- `claim_ticket` exists in SQL but is dead and `it_admin`-only; there is no `claim_rm_ticket`.
- `students`, `classes`, `attendance` have blanket `auth.role() = 'authenticated'` read policies, so "access to assigned students" is not real outside incidents.

## Decisions (agreed)

1. **Declarative permission matrix.** A central registry maps roles → named capabilities. The client reads it for route/nav/UI gating; a seeded Postgres table backs `has_permission()` for RLS and RPCs. Adding a role is a data change, not a code change.
2. **`staff` is the base role** and owns the scope concept (assigned students, assigned classes, own incidents, own ICT + R&M tickets). `teacher` retires into it.
3. **`property_staff` and `board_member` stay as reduced roles** held as extra `user_roles` rows on top of `staff`. Their capabilities are in the matrix, and assignee dropdowns filter by capability rather than role name.
4. **"Take ticket" gets a real claim RPC** — fix `claim_ticket` to be capability-gated, add `claim_rm_ticket`, and wire the existing "Assign to me" UI to them.
5. **Role-keyed dashboard** with a header role switcher for multi-role users, replacing the tier + precedence-subtype indirection.
6. **Student/class/attendance scope enforced in SQL** via the existing `effective_teacher_student_scope` view, not just in the page.
7. **`/staff`, `/assets`, `/admin` become `site_admin`-only.** `it_admin` keeps ticket powers only. This is a deliberate reduction from today's behaviour.

## Target model

### Roles (10, `teacher` retired)

`site_admin`, `it_admin`, `it_staff`, `property_manager`, `property_staff`, `counsellor`, `finance_admin`, `finance_read_only`, `board_member`, `staff`

A person holds `staff` as their base role plus any additional role rows. `site_admin` is a superuser shortcut, not a capability list.

### Capabilities

Grouped by module. `*.own` = created by the user, `*.assigned` = assigned to the user, `*.all` = module-wide.

| Group | Capabilities |
|---|---|
| students | `students.view_all`, `students.view_assigned` |
| classes | `classes.view_all`, `classes.view_assigned` |
| attendance | `attendance.view_all`, `attendance.view_assigned` |
| incidents | `incidents.create_own`, `incidents.view_own`, `incidents.view_all`, `incidents.update_own`, `incidents.update_all`, `incidents.assign`, `incidents.take`, `incidents.view_sensitive`, `incidents.export` |
| ICT tickets | `ict.create`, `ict.view_own`, `ict.view_assigned`, `ict.view_all`, `ict.update_assigned`, `ict.assign`, `ict.claim` |
| R&M tickets | `rm.create`, `rm.view_own`, `rm.view_assigned`, `rm.view_all`, `rm.update_assigned`, `rm.assign`, `rm.claim` |
| finance | `finance.view`, `finance.manage` |
| admin | `assets.manage`, `staff.view`, `staff.manage`, `access.manage`, `settings.manage` |

`site_admin` bypasses the matrix (any capability resolves true).

### Role → capability matrix

| Capability | staff | property_staff | it_staff | it_admin | property_manager | counsellor | finance_admin | finance_read_only | board_member |
|---|---|---|---|---|---|---|---|---|---|
| `students.view_assigned` | ● | ● | | | | ● | | | |
| `classes.view_assigned` | ● | ● | | | | ● | | | |
| `attendance.view_assigned` | ● | ● | | | | ● | | | |
| `incidents.create_own` | ● | | | | | ● | | | |
| `incidents.view_own` | ● | | | | | ● | | | |
| `incidents.update_own` | ● | | | | | ● | | | |
| `incidents.view_all` | | | | | | ● | | | |
| `incidents.update_all` | | | | | | ● | | | |
| `incidents.assign` | | | | | | ● | | | |
| `incidents.take` | | | | | | ● | | | |
| `incidents.view_sensitive` | | | | | | ● | | | |
| `incidents.export` | | | | | | ● | | | |
| `ict.create` / `ict.view_own` | ● | | ● | ● | ● | ● | | | |
| `ict.view_assigned` / `ict.update_assigned` | | | ● | ● | | | | | |
| `ict.view_all` / `ict.assign` / `ict.claim` | | | | ● | | | | | |
| `rm.create` / `rm.view_own` | ● | | ● | ● | ● | ● | | | |
| `rm.view_assigned` / `rm.update_assigned` | | ● | | ● | ● | | | | |
| `rm.view_all` / `rm.assign` / `rm.claim` | | | | ● | ● | | | | |
| `finance.view` | | | | | | | ● | ● | ● |
| `finance.manage` | | | | | | | ● | | | |
| `students/classes/attendance.view_all`, `assets.manage`, `staff.view`, `staff.manage`, `access.manage`, `settings.manage` | | | | | | | | | | (site_admin only) |

Note: `counsellor` keeping `students.view_assigned` preserves today's `canAccessSchoolRecords` behaviour for counsellors. `counsellor` is assumed to keep `incidents.view_sensitive` and `incidents.export` (matches `is_counsellor_or_leadership` and the existing export gating in `Incidents.tsx`) — confirm before Phase 1.

## Implementation tasks

### Phase 0 — Registry (no behaviour change)

1. Create `src/lib/access/registry.ts`: the capability union, the `ROLE_PERMISSIONS` map above, `SITE_ADMIN_ROLE`, `ALL_ROLES`, and `rolePrecedence` (used only to pick the default active role: `site_admin` > `it_admin` > `finance_admin` > `counsellor` > `property_manager` > `it_staff` > `staff`).
2. Create `src/lib/access/permissions.ts`: `capabilitiesForRoles(roles)`, `can(roles, capability)`, `canAll`, `canAny`, and role normalisation. No tier concept.
3. Create `src/lib/access/permissions.test.ts` asserting every capability in the union is reachable from at least one role, and that no role maps to an unknown capability.

### Phase 1 — Database matrix (no policy changes)

New migration `supabase/migrations/<ts>_permission_matrix.sql`:

1. `create table public.app_roles (role text primary key, label text not null, description text, is_retired boolean not null default false)` — the shared role catalogue. Seed all 10 roles plus `teacher` as `is_retired = true`.
2. `create table public.role_permissions (role text references public.app_roles(role), capability text not null, primary key (role, capability))`. RLS on, read-only for authenticated users, write restricted to `access.manage`.
3. `has_permission(p_user_id uuid default auth.uid(), p_capability text) returns boolean` — `SECURITY DEFINER`, `stable`: true if `user_has_role(p_user_id,'site_admin')`, else an `exists` join from `user_roles` (keeping the `active` + `effective_from`/`effective_to` window filter already in `user_has_role`) to `role_permissions`. Index `(capability, role)`.
4. `user_capabilities(p_user_id uuid) returns setof text` — for parity checks and debugging.
5. Seed `role_permissions` from the matrix.
6. Widen `user_roles_role_check` to include `staff`; leave `teacher` legal until Phase 3 completes.
7. Rewrite the existing helpers as thin wrappers over `has_permission`, keeping their current signatures so **no existing policy needs rewriting**:
   - `is_it_admin` → `has_permission(uid,'ict.assign')`
   - `is_it_staff` → `has_permission(uid,'ict.update_assigned')`
   - `is_access_admin` → `has_permission(uid,'access.manage')`
   - `is_counsellor_or_leadership` → `has_permission(uid,'incidents.view_sensitive')`
   - `is_rm_admin` → `has_permission(uid,'rm.assign')` (this also **fixes** the `site_admin` exclusion)
   - `is_rm_property_manager` → `has_permission(uid,'rm.assign')`; `is_rm_operator` stays the `or` of `is_rm_admin`/`is_rm_property_manager`, so the R&M operator set becomes `{it_admin, property_manager}` — unchanged, but no longer role-name literals.
   - `is_rm_leadership` → `has_permission(uid,'rm.view_all')` (today `site_admin`,`it_admin`,`property_manager`; the wider set is a deliberate consequence of Decision 7)
   - `can_access_ticket` / `can_access_rm_ticket` → recompose from the new `*.view_all` / requester / assignee checks.
   - `finance_can_view` → `finance.view`; `finance_can_manage` → `finance.manage`.
8. Relax the assignee guards: `assign_ticket` validates the assignee with `has_permission(p_assigned_to,'ict.update_assigned')` instead of `user_has_any_role(..., array['it_staff','it_admin'])` (`20260911000003:24-27`); `assign_rm_ticket` likewise with `rm.update_assigned`.

Verify with `supabase_get_advisors` for both security and performance, and with a parity query asserting `user_capabilities(uid)` equals the TS `capabilitiesForRoles` output for a sample of profiles.

### Phase 2 — Client switches to the matrix (presentation only)

9. Extend `AuthContext` with `activeRole` / `setActiveRole`, persisted in `localStorage` under the existing mock-auth key namespace, defaulting to the highest-privilege role from `rolePrecedence`. Roles stay additive; `activeRole` only picks the dashboard view and badge.
10. Add the role switcher to `src/components/layout/AppHeader.tsx`, rendered only when the user holds more than one role.
11. Replace `canAccessRoute` with a `Record<string, Capability | Capability[]>` route→capability map in `src/lib/access/routes.ts`; update `src/App.tsx` `RouteGuard` (`:65-91`) to use it. Keep the existing `toast.error("Page unavailable", ...)` + redirect-to-`/` behaviour, and add the missing `RouteGuard` on `/tickets` (`:138`) for consistency with `canAccessRoute`'s old `default: return true`.
12. Update `src/components/layout/navigation.ts` to filter `shellNavItems` by capability instead of by path. Drop the declared-but-unused `tiers` / `subtypes` fields (`:19-21,32-44`) and the tier/subtype label overrides (`:52-80`), replacing them with role labels.
13. Rewrite the capability block in `src/pages/Tickets.tsx:268-275` as `can()` calls, and point the assignee dropdowns (`:125-128,165-168,359-365`) at `ict.update_assigned` / `rm.update_assigned` instead of hardcoded role names. Remove `isReadOnlyLeadership`.
14. `src/pages/Incidents.tsx:136-137` and `src/pages/incidents/utils.ts:1`: derive `canManageSensitive` from `incidents.view_sensitive`; delete the duplicated inline lists in `supabaseApi.ts:818,980`.
15. `src/pages/Finance.tsx:16`: `canManage = can(user.roles,'finance.manage')`.
16. `supabase/functions/account-admin/auth.ts:18,123-129`: replace `ACCOUNT_ADMIN_ROLES` with an `access.manage` check, keeping the comment that it mirrors the SQL helper.

### Phase 3 — `teacher` → `staff` grant migration

17. Migration: insert a `staff` `user_roles` row for every profile currently holding `teacher` (preserving each grant's `effective_from`/`effective_to`), then set the `teacher` rows `active = false` rather than deleting them. Keep `teacher` in `app_roles` as retired so the backout window is safe.
18. Update the role grant UI in `src/pages/Admin.tsx` (`:119-132` `roleOptions`, `:142` `scopeModeOptions`) to the new role set, and drop `teacher` from the grantable list.
19. Update `src/lib/mock-auth.ts` personas: one per role including `staff`, `counsellor`, `property_manager`, plus multi-role personas (`staff`+`property_staff`, `it_staff`+`staff`).

### Phase 4 — "Take ticket"

20. Redefine `claim_ticket` to require `ict.claim` (drop the `is_it_admin` check) and to refuse to overwrite an existing assignee — raise a distinct message so the UI can tell "already taken" from "not permitted". Add `claim_rm_ticket` mirroring it.
21. Add `claimTicket` / `claimRmTicket` wrappers in `supabaseApi.ts` next to the existing `assignTicket` / `assignRmTicket`, and route `handleAssignToSelf` (`Tickets.tsx:783-793`) to them.

### Phase 5 — Scope enforcement (riskiest)

22. Replace the blanket `auth.role() = 'authenticated'` read policies on `students`, `classes`, `attendance` (from `20260907000001_school_management_schema.sql`) with capability-and-scope policies over `effective_teacher_student_scope`:
    - `students`: `students.view_all` OR (`students.view_assigned` AND `id in (select student_id from effective_teacher_student_scope where teacher_id = auth.uid())`).
    - `classes`: `classes.view_all` OR (`classes.view_assigned` AND `id in (select class_id from class_staff_assignments where staff_profile_id = auth.uid() and window active)`).
    - `attendance`: same as students via the join.
    - Keep a `site_admin` full-access branch in each so admin and Workspace sync paths are unaffected.
23. Audit `syncStudentsFromGoogleWorkspace` / `syncStaffFromGoogleWorkspace` before removing the blanket write policies — if they rely on the anon-authenticated blanket `for all` policy, they need `assets.manage`/`staff.manage` or the service role first.
24. Apply the missing window filter in the dashboard scope counts and read from the view: `supabaseApi.ts:2041-2042` filters `class_staff_assignments` and `teacher_student_scope` with no `effective_from`/`effective_to` filter and omits the class-derived rows, so "students in scope" disagrees with `is_student_in_effective_scope`.

### Phase 6 — Role-keyed dashboard

25. `src/lib/dashboard/profiles.ts`: move `getDashboardProfile` (`Dashboard.tsx:83-156`) and `getDashboardCopy` (`DashboardOverview.tsx:377+`) into a registry keyed by role, replacing tier/subtype parameters. Keep the existing `canAccessRoute` post-filter on metrics/priority items/shortcuts (`:624-627,646`) so a role never links to a page it cannot open.
26. `loadDashboardSnapshot` (`:669-721`) should pass `activeRole` and only issue the finance leg when `can(roles,'finance.view')`.
27. Rename `dashboard_stats_for_tier(p_tier)` → `dashboard_stats_for_role(p_role text)` keyed on capability lookups, and update `fetchDashboardStatsForTier` → `fetchDashboardStatsForRole`. Update `shouldUseDashboardStatsRpc()`'s local-stack exclusion — the RPC path is disabled on port `54321`, so the local fallback must carry the new role branches too.

### Phase 7 — Cleanup

28. Delete `src/lib/role-tier.ts` and its consumers' tier branches: `AppShell.tsx:25-26`, `AppSidebar.tsx:88-96`, `AppHeader.tsx:93,185`, `Dashboard.tsx:450-598`, `Tickets.tsx:236,273`, `navigation.ts:237,280`, `DashboardOverview.tsx:472`, and the dead exports in `supabaseApi.ts:1099-1105`.
29. Stop reading the legacy `staff.role` column. `supabaseApi.ts:2072` and `20260930020000:144` both count `staff.role = 'it_staff'` while `assign_ticket` validates against `user_roles` — two definitions of "active IT staff". Also note `normalizeStaffDirectoryRow` (`:117`) overwrites `role` with `roles[0]`, so the column is already partly derived; stop treating it as authoritative.
30. Decide the fate of legacy `property_rm` ICT tickets. That category is seeded as an ICT category (`20260915000000:4`) and hidden from `/ict-tickets`, but the rows live in `tickets`, not `rm_tickets`, so they are invisible on `/rm-tickets` too. No migration moves them.

## Preserved

Route paths and deep links, `ProtectedRoute`/`PublicRoute` behaviour and the unauthorized toast, the `user_roles` store and its date-windowing, the `effective_teacher_student_scope` view and `is_student_in_effective_scope`, the ticket status lifecycle and `transition_ticket_status` / `transition_rm_ticket_status` state machines, the manual account provisioning flow and `pending_roles` staging, `fetchCurrentUserRoles` as the client's role source, all 11 mock personas (extended, not replaced), NZD-only finance, and the existing `Card`/`DataTable`/`Dialog`/`StatisticCard` UI primitives.

## Validation

- `npm run build`, `npm run lint`, `npm run test` after Phases 0, 2, 6.
- `supabase_get_advisors` (security + performance) after each migration phase.
- Parity check: for a sample of profiles, `select profile_id, array_agg(capability) from user_capabilities(profile_id)` equals the TS `capabilitiesForRoles` output. Fail the build on drift.
- Per-persona walkthrough of `/sandbox` as each of the 10 roles, confirming the nav, dashboard sections, and button set match the matrix.
- Negative tests against the running local stack, not just the UI:
  - a `staff` profile selecting a student outside its scope returns 0 rows;
  - `claim_ticket` as an `it_staff` succeeds on an unassigned ticket and raises on an already-assigned one;
  - `assign_rm_ticket` as `site_admin` no longer raises (the Phase 1 fix);
  - a `finance_read_only` profile is denied on every `finance.manage` RPC.
- Confirm `git status` is clean of generated `database.types.ts` drift after regenerating types.

## Risks

- **Phase 5 can lock people out.** `students`, `classes`, and `attendance` currently have blanket authenticated read policies; replacing them is the highest-blast-radius step. Do it in the local stack first, and keep an explicit `site_admin` full-access branch.
- **Google Workspace sync** may depend on the blanket `for all` policies being removed. Audit before Phase 5, not during.
- **TS/SQL drift** is the failure mode this design is meant to eliminate, so the parity check is not optional.
- **Role windows.** Capability checks must keep the `effective_from`/`effective_to` filter; a grant whose window has closed must not resolve to a capability. The dashboard currently gets this wrong.
- **Behaviour reduction for `it_admin`** losing `/staff`, `/assets`, `/admin` is intentional per decision 7, but it will be visible to existing accounts and should be called out in the rollout.
- **`teacher` grant migration** must run after the client understands `staff` (Phase 2 before Phase 3) so nobody is left role-less mid-deploy.

## Open questions

1. Confirm `counsellor` keeps `incidents.view_sensitive` and `incidents.export` (assumed yes, matching today).
2. `finance_read_only` and `board_member` now hold identical capabilities — collapse into one role, or keep both for organisational clarity?
3. Legacy `property_rm` ICT tickets: migrate into `rm_tickets`, or freeze in place as read-only history?
