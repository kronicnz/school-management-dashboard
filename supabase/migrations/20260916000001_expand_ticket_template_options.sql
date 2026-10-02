-- Expand ICT and R&M template option sets for better guided intake.

update public.ticket_template_steps s
set config = '{"field_type":"segment","prompt":"What is the business impact?","options":["No immediate impact","Small group affected","One class or office blocked","Multiple classes affected","School-wide impact"]}'::jsonb
from public.ticket_templates t
where t.id = s.template_id
  and t.code = 'password_reset_account_locked'
  and s.step_key = 'blocker';

update public.ticket_template_steps s
set config = '{"field_type":"select","prompt":"How many tabs are open?","options":["1-5","6-10","11-20","21-30","30+"]}'::jsonb
from public.ticket_templates t
where t.id = s.template_id
  and t.code = 'chromebook_slow_freezing'
  and s.step_key = 'tabs';

update public.ticket_template_steps s
set config = '{"field_type":"select","prompt":"What is the display issue?","options":["Blank screen","Flickering","External monitor only","Dock not detected","Resolution or scaling issue","No signal"]}'::jsonb
from public.ticket_templates t
where t.id = s.template_id
  and t.code = 'laptop_display_dock_issue'
  and s.step_key = 'screen';

update public.ticket_template_steps s
set config = '{"field_type":"select","prompt":"What does the desktop do?","options":["No power","Fans on, no display","Boot loop","Monitor only","Intermittent restarts"]}'::jsonb
from public.ticket_templates t
where t.id = s.template_id
  and t.code = 'desktop_no_display'
  and s.step_key = 'power';

update public.ticket_template_steps s
set config = '{"field_type":"select","prompt":"How many devices are affected?","options":["One device","A few devices","Whole room","Whole year level","Whole school"]}'::jsonb
from public.ticket_templates t
where t.id = s.template_id
  and t.code = 'wifi_connectivity'
  and s.step_key = 'devices';

update public.ticket_template_steps s
set config = '{"field_type":"select","prompt":"What is affected?","options":["Internet only","Wi-Fi only","Both Wi-Fi and internet","Intermittent dropouts","Not sure"]}'::jsonb
from public.ticket_templates t
where t.id = s.template_id
  and t.code = 'internet_outage'
  and s.step_key = 'outage_scope';

update public.ticket_template_steps s
set config = '{"field_type":"select","prompt":"What is the printer doing?","options":["Offline","Paper jam","Blank pages","Won''t print","Toner/ink issue","Slow printing","Error light"]}'::jsonb
from public.ticket_templates t
where t.id = s.template_id
  and t.code = 'printer_offline'
  and s.step_key = 'issue';

update public.ticket_template_steps s
set config = '{"field_type":"select","prompt":"Which device is affected?","options":["TV","Projector","Chromecast","Interactive panel","Apple TV","HDMI switch"]}'::jsonb
from public.ticket_templates t
where t.id = s.template_id
  and t.code = 'tv_projector_casting'
  and s.step_key = 'device';

update public.ticket_template_steps s
set config = '{"field_type":"select","prompt":"What are you casting from?","options":["Chromebook","Laptop","iPad","Desktop","Document camera","Other"]}'::jsonb
from public.ticket_templates t
where t.id = s.template_id
  and t.code = 'tv_projector_casting'
  and s.step_key = 'source';

update public.ticket_template_steps s
set config = '{"field_type":"select","prompt":"Which Google service is affected?","options":["Drive","Docs","Slides","Classroom","Gmail","Meet","Shared drive"]}'::jsonb
from public.ticket_templates t
where t.id = s.template_id
  and t.code = 'google_apps_issue'
  and s.step_key = 'service';

update public.ticket_template_steps s
set config = '{"field_type":"select","prompt":"Which Microsoft app is affected?","options":["Teams","Word","Excel","PowerPoint","OneDrive","Outlook","Forms"]}'::jsonb
from public.ticket_templates t
where t.id = s.template_id
  and t.code = 'microsoft_apps_issue'
  and s.step_key = 'service';

update public.ticket_template_steps s
set config = '{"field_type":"select","prompt":"Which accessory is faulty?","options":["Keyboard","Mouse","Headset","Charger","Cable","Dock","Other"]}'::jsonb
from public.ticket_templates t
where t.id = s.template_id
  and t.code = 'peripheral_keyboard_mouse'
  and s.step_key = 'accessory';

update public.rm_ticket_template_steps s
set config = '{"field_type":"select","prompt":"Which location needs attention?","options":["Classroom","Office","Hallway","Bathroom","Lab","Hall","Outside","Car park","Roof space","Other"]}'::jsonb
from public.rm_ticket_templates t
where t.id = s.template_id
  and s.step_key = 'location';

update public.rm_ticket_template_steps s
set config = '{"field_type":"select","prompt":"What asset, room, or area is affected?","options":["Tap / sink","Pipe / drain","Light fitting","Door / lock","Window / glass","Toilet / basin","Heating / vent","Floor / wall","Furniture","Playground equipment","Access route","Other"]}'::jsonb
from public.rm_ticket_templates t
where t.id = s.template_id
  and s.step_key = 'asset_area';

update public.rm_ticket_template_steps s
set config = '{"field_type":"select","prompt":"How urgent is the issue?","options":["Routine","Low","Medium","High","Critical","Emergency"]}'::jsonb
from public.rm_ticket_templates t
where t.id = s.template_id
  and s.step_key = 'urgency';

update public.rm_ticket_template_steps s
set config = '{"field_type":"select","prompt":"Any access, safety, or supervision notes?","options":["No access issues","Need keys","Can enter with class present","After hours only","Health and safety escort needed","Contractor access required"]}'::jsonb
from public.rm_ticket_templates t
where t.id = s.template_id
  and s.step_key = 'access_notes';

update public.rm_ticket_template_steps s
set config = '{"field_type":"select","prompt":"Preferred visit window","options":["Before school","Morning","Midday","Afternoon","After school","Flexible","Urgent attendance required"]}'::jsonb
from public.rm_ticket_templates t
where t.id = s.template_id
  and s.step_key = 'visit_window';

insert into public.rm_ticket_template_steps (template_id, step_key, label, sort_order, config, required)
select t.id, s.step_key, s.label, s.sort_order, s.config, s.required
from public.rm_ticket_templates t
join (
  values
    ('location', 'Location', 1, '{"field_type":"select","prompt":"Which location needs attention?","options":["Classroom","Office","Hallway","Bathroom","Lab","Hall","Outside","Car park","Roof space","Other"]}'::jsonb, true),
    ('asset_area', 'Asset / area', 2, '{"field_type":"select","prompt":"What asset, room, or area is affected?","options":["Tap / sink","Pipe / drain","Light fitting","Door / lock","Window / glass","Toilet / basin","Heating / vent","Floor / wall","Furniture","Playground equipment","Access route","Other"]}'::jsonb, true),
    ('issue_summary', 'Issue summary', 3, '{"field_type":"textarea","prompt":"Describe the repair or defect."}'::jsonb, true),
    ('urgency', 'Urgency', 4, '{"field_type":"select","prompt":"How urgent is the issue?","options":["Routine","Low","Medium","High","Critical","Emergency"]}'::jsonb, true),
    ('access_notes', 'Access notes', 5, '{"field_type":"select","prompt":"Any access, safety, or supervision notes?","options":["No access issues","Need keys","Can enter with class present","After hours only","Health and safety escort needed","Contractor access required"]}'::jsonb, false),
    ('visit_window', 'Visit window', 6, '{"field_type":"select","prompt":"Preferred visit window","options":["Before school","Morning","Midday","Afternoon","After school","Flexible","Urgent attendance required"]}'::jsonb, false)
) as s(step_key, label, sort_order, config, required)
  on true
on conflict (template_id, step_key) do update
set label = excluded.label,
    sort_order = excluded.sort_order,
    config = excluded.config,
    required = excluded.required;
