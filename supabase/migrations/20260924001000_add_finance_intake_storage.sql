insert into storage.buckets (id, name, public)
values ('finance-intake-attachments', 'finance-intake-attachments', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Finance attachment storage readable by finance users" on storage.objects;
create policy "Finance attachment storage readable by finance users"
on storage.objects
for select
using (
  bucket_id = 'finance-intake-attachments'
  and (
    public.finance_can_view()
    or exists (
      select 1
      from public.finance_intake_items fi
      where fi.storage_path = name
        and public.finance_can_view()
    )
  )
);

drop policy if exists "Finance attachment storage writable by finance admins" on storage.objects;
create policy "Finance attachment storage writable by finance admins"
on storage.objects
for insert
with check (bucket_id = 'finance-intake-attachments' and public.finance_can_manage());

drop policy if exists "Finance attachment storage deletable by finance admins" on storage.objects;
create policy "Finance attachment storage deletable by finance admins"
on storage.objects
for delete
using (bucket_id = 'finance-intake-attachments' and public.finance_can_manage());
