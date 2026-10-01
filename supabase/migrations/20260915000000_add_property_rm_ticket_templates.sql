-- Property R&M ticket taxonomy

insert into public.ticket_categories (code, name, sort_order)
values ('property_rm', 'Property R&M', 13)
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'repair_request', 'Repair request', 'General building repairs and defects requiring follow-up.', 1, true
from public.ticket_categories c
where c.code = 'property_rm'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'inspection_follow_up', 'Inspection follow-up', 'Follow-up work captured after a property inspection or cyclical check.', 1, true
from public.ticket_categories c
where c.code = 'property_rm'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'contractor_visit', 'Contractor visit', 'Book and track contractor attendance, access, and site notes.', 1, true
from public.ticket_categories c
where c.code = 'property_rm'
on conflict (code) do nothing;

insert into public.ticket_template_steps (template_id, step_key, label, sort_order, config, required)
select t.id, s.step_key, s.label, s.sort_order, s.config, s.required
from public.ticket_templates t
join (
  values
    ('repair_request', 'location', 'Location', 1, '{"field_type":"short_text","prompt":"Which location needs attention?"}'::jsonb, true),
    ('repair_request', 'asset_area', 'Asset / area', 2, '{"field_type":"short_text","prompt":"What asset, room, or area is affected?"}'::jsonb, true),
    ('repair_request', 'issue_summary', 'Issue summary', 3, '{"field_type":"textarea","prompt":"Describe the repair or defect."}'::jsonb, true),
    ('repair_request', 'urgency', 'Urgency', 4, '{"field_type":"select","prompt":"How urgent is the issue?","options":["Low","Medium","High","Critical"]}'::jsonb, true),
    ('repair_request', 'access_notes', 'Access notes', 5, '{"field_type":"textarea","prompt":"Any access, safety, or supervision notes?"}'::jsonb, false),
    ('repair_request', 'visit_window', 'Visit window', 6, '{"field_type":"select","prompt":"Preferred visit window","options":["Morning","Midday","Afternoon","After school","Flexible"]}'::jsonb, false),
    ('inspection_follow_up', 'location', 'Location', 1, '{"field_type":"short_text","prompt":"Which location needs attention?"}'::jsonb, true),
    ('inspection_follow_up', 'asset_area', 'Asset / area', 2, '{"field_type":"short_text","prompt":"What asset, room, or area is affected?"}'::jsonb, true),
    ('inspection_follow_up', 'issue_summary', 'Issue summary', 3, '{"field_type":"textarea","prompt":"Describe the follow-up work."}'::jsonb, true),
    ('inspection_follow_up', 'urgency', 'Urgency', 4, '{"field_type":"select","prompt":"How urgent is the follow-up?","options":["Low","Medium","High","Critical"]}'::jsonb, true),
    ('inspection_follow_up', 'access_notes', 'Access notes', 5, '{"field_type":"textarea","prompt":"Any access, safety, or supervision notes?"}'::jsonb, false),
    ('inspection_follow_up', 'visit_window', 'Visit window', 6, '{"field_type":"select","prompt":"Preferred visit window","options":["Morning","Midday","Afternoon","After school","Flexible"]}'::jsonb, false),
    ('contractor_visit', 'location', 'Location', 1, '{"field_type":"short_text","prompt":"Which location needs attention?"}'::jsonb, true),
    ('contractor_visit', 'asset_area', 'Asset / area', 2, '{"field_type":"short_text","prompt":"What asset, room, or area is affected?"}'::jsonb, true),
    ('contractor_visit', 'issue_summary', 'Issue summary', 3, '{"field_type":"textarea","prompt":"Describe the contractor work or booking."}'::jsonb, true),
    ('contractor_visit', 'urgency', 'Urgency', 4, '{"field_type":"select","prompt":"How urgent is the visit?","options":["Low","Medium","High","Critical"]}'::jsonb, true),
    ('contractor_visit', 'access_notes', 'Access notes', 5, '{"field_type":"textarea","prompt":"Any access, safety, or supervision notes?"}'::jsonb, false),
    ('contractor_visit', 'visit_window', 'Visit window', 6, '{"field_type":"select","prompt":"Preferred visit window","options":["Morning","Midday","Afternoon","After school","Flexible"]}'::jsonb, false)
) as s(template_code, step_key, label, sort_order, config, required)
  on s.template_code = t.code
on conflict (template_id, step_key) do nothing;
