-- -----------------------------------------------------------------------------
-- Move legacy `property_rm` ICT tickets into `rm_tickets`
--
-- `property_rm` was seeded as an ICT category but describes R&M work. The rows live
-- in `tickets`, so they were invisible everywhere: `Tickets.tsx:280,287` filters the
-- category out of the ICT module, and `/rm-tickets` reads `rm_tickets`, which never
-- received them. The category was reachable for raising but its history could never
-- be seen or worked.
--
-- This moves any such ticket, with its comments, attachments, audit trail, and
-- notifications, into the R&M module where the rest of the lifecycle applies.
--
-- Design notes:
--
--   * The ticket keeps its primary key. Both modules have identical column sets and
--     identical `status` / `priority` check constraints, so the row copies across
--     without translation. Keeping the id also means the child rows only need their
--     parent id preserved, and `ticket_number` is untouched so the number a
--     requester was quoted still resolves. The `ICT-` prefix is retained
--     deliberately: `next_rm_ticket_number` mints `RM-` numbers from a separate
--     counter, so there is no collision, and overwriting it would break the audit
--     trail and anything already recorded against that number.
--
--   * A matching `property_rm` row is created in `rm_ticket_categories` rather than
--     remapping onto `property_maintenance`, because collapsing the two would merge
--     a generic legacy bucket with the current taxonomy and lose that distinction.
--
--   * The ICT category is deactivated, not deleted, so the category list keeps a
--     stable id and the move is auditable.
--
--   * Rows are moved only while the R&M category is absent or the copy is otherwise
--     safe; the guard at the end fails loudly rather than silently duplicating.
--
--   * `template_id` cannot cross modules: `rm_tickets.template_id` references
--     `rm_ticket_templates`, and the legacy rows point at ICT templates. Imported
--     rows are pointed at a dedicated `legacy_property_rm_import` R&M template,
--     with the original ICT template id preserved in `template_snapshot` under
--     `migrated_from_template`.
--
-- Order matters: the ticket moves first because every child row carries a foreign
-- key to it, then the children follow, then the ICT copies are removed. Deleting
-- the source ticket first would trip its own ON DELETE RESTRICT constraints.
--
-- On a database with no `property_rm` history this is a no-op apart from creating
-- the category and deactivating the ICT one.
-- -----------------------------------------------------------------------------

do $$
declare
  v_rm_category uuid;
  v_rm_template uuid;
  v_moved integer := 0;
begin
  insert into public.rm_ticket_categories (code, name, active, sort_order)
  values ('property_rm', 'Property R&M', true, 12)
  on conflict (code) do update set name = excluded.name, active = true
  returning id into v_rm_category;

  -- The original rows point at ICT templates and `rm_tickets.template_id` is a
  -- foreign key into `rm_ticket_templates`, so the reference cannot be carried
  -- across. Each imported row is pointed at this dedicated legacy template and
  -- keeps its original ICT template recorded inside `template_snapshot` under
  -- `migrated_from_template`, so the provenance is not lost.
  insert into public.rm_ticket_templates (category_id, code, name, description, active, version)
  values (
    v_rm_category,
    'legacy_property_rm_import',
    'Legacy property R&M import',
    'Carries ICT tickets raised under the retired property_rm ICT category.',
    true,
    1
  )
  on conflict (code) do update set category_id = excluded.category_id, name = excluded.name
  returning id into v_rm_template;

  -- The parent moves first: the child rows below reference it.
  insert into public.rm_tickets (
    id, ticket_number, requester_id, category_id, template_id, template_version, template_snapshot,
    assigned_to, assigned_by, status, priority, close_requested_at, closed_by_requester_at,
    title, summary, submission_payload, device_context, request_context,
    is_deleted, deleted_at, deleted_by, deleted_reason, created_at, updated_at
  )
  select t.id, t.ticket_number, t.requester_id, v_rm_category, v_rm_template, 1,
    coalesce(t.template_snapshot, '{}'::jsonb)
      || jsonb_build_object('migrated_from_template', t.template_id),
    t.assigned_to, t.assigned_by, t.status, t.priority, t.close_requested_at, t.closed_by_requester_at,
    t.title, t.summary, t.submission_payload, t.device_context, t.request_context,
    t.is_deleted, t.deleted_at, t.deleted_by, t.deleted_reason, t.created_at, t.updated_at
  from public.tickets t
  join public.ticket_categories cat on cat.id = t.category_id
  where cat.code = 'property_rm'
  on conflict (id) do nothing;

  get diagnostics v_moved = row_count;

  insert into public.rm_ticket_comments (
    id, ticket_id, author_id, comment_type, is_close_request, content, is_deleted, created_at, updated_at
  )
  select c.id, c.ticket_id, c.author_id, c.comment_type, c.is_close_request, c.content, c.is_deleted, c.created_at, c.updated_at
  from public.ticket_comments c
  join public.tickets t on t.id = c.ticket_id
  join public.ticket_categories cat on cat.id = t.category_id
  where cat.code = 'property_rm'
  on conflict (id) do nothing;

  insert into public.rm_ticket_attachments (
    id, ticket_id, uploaded_by, storage_path, file_name, mime_type, file_size, visibility, created_at, updated_at
  )
  select a.id, a.ticket_id, a.uploaded_by, a.storage_path, a.file_name, a.mime_type, a.file_size, a.visibility, a.created_at, a.updated_at
  from public.ticket_attachments a
  join public.tickets t on t.id = a.ticket_id
  join public.ticket_categories cat on cat.id = t.category_id
  where cat.code = 'property_rm'
  on conflict (id) do nothing;

  insert into public.rm_ticket_audit_log (id, ticket_id, action, changed_by, before_data, after_data, context, changed_at)
  select l.id, l.ticket_id, l.action, l.changed_by, l.before_data, l.after_data, l.context, l.changed_at
  from public.ticket_audit_log l
  join public.tickets t on t.id = l.ticket_id
  join public.ticket_categories cat on cat.id = t.category_id
  where cat.code = 'property_rm'
  on conflict (id) do nothing;

  insert into public.rm_ticket_notifications (
    id, ticket_id, recipient_id, channel, event_type, delivered_at, status, payload, created_at, updated_at
  )
  select n.id, n.ticket_id, n.recipient_id, n.channel, n.event_type, n.delivered_at, n.status, n.payload, n.created_at, n.updated_at
  from public.ticket_notifications n
  join public.tickets t on t.id = n.ticket_id
  join public.ticket_categories cat on cat.id = t.category_id
  where cat.code = 'property_rm'
  on conflict (id) do nothing;

  -- Retire the ICT category so no new row lands where history is no longer read.
  update public.ticket_categories
  set active = false, updated_at = now()
  where code = 'property_rm' and active;

  -- The children must be gone before the RESTRICT foreign keys allow the delete.
  delete from public.ticket_comments c
  using public.tickets t, public.ticket_categories cat
  where c.ticket_id = t.id and cat.id = t.category_id and cat.code = 'property_rm';

  delete from public.ticket_attachments a
  using public.tickets t, public.ticket_categories cat
  where a.ticket_id = t.id and cat.id = t.category_id and cat.code = 'property_rm';

  delete from public.ticket_audit_log l
  using public.tickets t, public.ticket_categories cat
  where l.ticket_id = t.id and cat.id = t.category_id and cat.code = 'property_rm';

  delete from public.ticket_notifications n
  using public.tickets t, public.ticket_categories cat
  where n.ticket_id = t.id and cat.id = t.category_id and cat.code = 'property_rm';

  delete from public.tickets t
  using public.ticket_categories cat
  where cat.id = t.category_id and cat.code = 'property_rm';

  raise notice 'property_rm tickets moved into rm_tickets: %', v_moved;

  -- `rm_ticket_audit_log.id` is a bigserial and the copy above inserts explicit
  -- ids, which does not advance the sequence. Left alone, the next row written by
  -- the audit trigger collides with an imported id, so the sequence is resynced.
  perform setval(
    pg_get_serial_sequence('public.rm_ticket_audit_log', 'id'),
    greatest(coalesce((select max(id) from public.rm_ticket_audit_log), 0), 1)
  );
end $$;

do $$
declare
  v_remaining integer;
  v_orphans integer;
begin
  select count(*) into v_remaining
  from public.tickets t
  join public.ticket_categories cat on cat.id = t.category_id
  where cat.code = 'property_rm';

  if v_remaining <> 0 then
    raise exception 'property_rm ICT tickets still present: %', v_remaining;
  end if;

  -- A moved ticket whose children were left behind would read as complete here
  -- while silently losing its comments and attachments, so count them explicitly.
  select count(*) into v_orphans from (
    select c.id from public.ticket_comments c
      join public.tickets t on t.id = c.ticket_id
      join public.ticket_categories cat on cat.id = t.category_id
      where cat.code = 'property_rm'
    union all
    select a.id from public.ticket_attachments a
      join public.tickets t on t.id = a.ticket_id
      join public.ticket_categories cat on cat.id = t.category_id
      where cat.code = 'property_rm'
    union all
    select n.id from public.ticket_notifications n
      join public.tickets t on t.id = n.ticket_id
      join public.ticket_categories cat on cat.id = t.category_id
      where cat.code = 'property_rm'
  ) leftover;

  if v_orphans <> 0 then
    raise exception 'property_rm child rows still attached to ICT tickets: %', v_orphans;
  end if;
end $$;
