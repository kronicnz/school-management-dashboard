-- Ensure incident audit triggers can write to the RLS-protected audit log.

create or replace function public.log_incident_change()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'incident_created';
  else
    if old.is_deleted = false and new.is_deleted = true then
      v_action := 'incident_soft_deleted';
    elsif old.is_deleted = true and new.is_deleted = false then
      v_action := 'incident_restored';
    elsif old.visibility is distinct from new.visibility then
      v_action := 'incident_visibility_changed';
    elsif old.status is distinct from new.status then
      v_action := 'incident_status_changed';
    else
      v_action := 'incident_updated';
    end if;
  end if;

  insert into public.incident_audit_log (
    incident_id,
    action,
    changed_by,
    before_data,
    after_data,
    context
  )
  values (
    coalesce(new.id, old.id),
    v_action,
    auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    jsonb_build_object(
      'transition_reason', nullif(current_setting('app.incident_transition_reason', true), ''),
      'trigger', tg_name
    )
  );

  return new;
end;
$$;

create or replace function public.log_incident_comment_change()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
begin
  insert into public.incident_audit_log (
    incident_id,
    action,
    changed_by,
    before_data,
    after_data,
    context
  )
  values (
    coalesce(new.incident_id, old.incident_id),
    case
      when tg_op = 'INSERT' then 'incident_comment_created'
      when old.is_deleted = false and new.is_deleted = true then 'incident_comment_soft_deleted'
      else 'incident_comment_updated'
    end,
    auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    jsonb_build_object('trigger', tg_name)
  );

  return new;
end;
$$;
