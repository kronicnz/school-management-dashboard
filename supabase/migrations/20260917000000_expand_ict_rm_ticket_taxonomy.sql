-- Expand ICT and R&M ticket taxonomies with more intermediate-school cases.

insert into public.ticket_categories (code, name, sort_order)
values
  ('classroom_av', 'Classroom AV', 13),
  ('accounts_access', 'Accounts / Access', 14),
  ('learning_platforms', 'Learning platforms', 15),
  ('peripherals_audio', 'Peripherals / Audio', 16)
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'interactive_panel_touch_issue', 'Interactive panel / touch issue', 'Touch, calibration, and classroom display faults for boards, panels, and projectors.', 1, true
from public.ticket_categories c
where c.code = 'classroom_av'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'projector_or_casting_issue', 'Projector or casting issue', 'Input, casting, and classroom screen faults during lesson delivery.', 1, true
from public.ticket_categories c
where c.code = 'classroom_av'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'classroom_audio_issue', 'Classroom audio issue', 'Speaker, microphone, and classroom sound problems.', 1, true
from public.ticket_categories c
where c.code = 'classroom_av'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'student_login_problem', 'Student login problem', 'Student account access, sign-in, and profile loading issues.', 1, true
from public.ticket_categories c
where c.code = 'accounts_access'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'staff_account_or_mfa_issue', 'Staff account or MFA issue', 'Staff access, account lockouts, and multi-factor authentication problems.', 1, true
from public.ticket_categories c
where c.code = 'accounts_access'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'classroom_submission_issue', 'Classroom or assignment issue', 'Missing assignments, submission problems, and class access faults.', 1, true
from public.ticket_categories c
where c.code = 'learning_platforms'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'website_or_filter_block', 'Website or filter block', 'Blocked websites, approval requests, and content filter issues.', 1, true
from public.ticket_categories c
where c.code = 'learning_platforms'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'headset_or_mic_not_working', 'Headset or microphone not working', 'Audio input and output faults on headsets, microphones, and cameras.', 1, true
from public.ticket_categories c
where c.code = 'peripherals_audio'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'charger_or_cable_fault', 'Charger or cable fault', 'Charging, cable, adapter, and loose connection issues.', 1, true
from public.ticket_categories c
where c.code = 'peripherals_audio'
on conflict (code) do nothing;

insert into public.ticket_template_steps (template_id, step_key, label, sort_order, config, required)
select t.id, s.step_key, s.label, s.sort_order, s.config, s.required
from public.ticket_templates t
join (
  values
    ('interactive_panel_touch_issue', 'location', 'Location', 1, '{"field_type":"select","prompt":"Which location needs attention?","options":["Classroom","Library","Hall","Specialist room","Office","Other"]}'::jsonb, true),
    ('interactive_panel_touch_issue', 'device', 'Display device', 2, '{"field_type":"select","prompt":"Which device is affected?","options":["Interactive panel","Projector","TV screen","Chromecast","HDMI switch","Other"]}'::jsonb, true),
    ('interactive_panel_touch_issue', 'issue_type', 'Issue type', 3, '{"field_type":"select","prompt":"What is the main fault?","options":["No signal","Touch not responding","Sound not working","Won''t power on","Flickering image","Wrong input","Other"]}'::jsonb, true),
    ('interactive_panel_touch_issue', 'impact', 'Impact', 4, '{"field_type":"segment","prompt":"How many learners or staff are affected?","options":["One class","Multiple classes","Whole year level","Whole school"]}'::jsonb, true),
    ('interactive_panel_touch_issue', 'restart_check', 'Restart check', 5, '{"field_type":"yes_no","prompt":"Have you restarted the display or changed the input?"}'::jsonb, false),
    ('interactive_panel_touch_issue', 'access_notes', 'Access notes', 6, '{"field_type":"textarea","prompt":"Any access, supervision, or timing notes?"}'::jsonb, false),
    ('projector_or_casting_issue', 'location', 'Location', 1, '{"field_type":"select","prompt":"Which location needs attention?","options":["Classroom","Library","Hall","Specialist room","Office","Other"]}'::jsonb, true),
    ('projector_or_casting_issue', 'source_device', 'Source device', 2, '{"field_type":"select","prompt":"What are you casting from?","options":["Chromebook","Laptop","iPad","Desktop","Document camera","Other"]}'::jsonb, true),
    ('projector_or_casting_issue', 'issue_type', 'Issue type', 3, '{"field_type":"select","prompt":"What is the display fault?","options":["No signal","Wrong input","Black screen","Audio missing","Lag or delay","Resolution issue","Other"]}'::jsonb, true),
    ('projector_or_casting_issue', 'impact', 'Impact', 4, '{"field_type":"segment","prompt":"How many learners or staff are affected?","options":["One class","Multiple classes","Whole year level","Whole school"]}'::jsonb, true),
    ('projector_or_casting_issue', 'cable_check', 'Cable check', 5, '{"field_type":"yes_no","prompt":"Have you checked the cable or adapter?"}'::jsonb, false),
    ('projector_or_casting_issue', 'access_notes', 'Access notes', 6, '{"field_type":"textarea","prompt":"Any access, supervision, or timing notes?"}'::jsonb, false),
    ('classroom_audio_issue', 'location', 'Location', 1, '{"field_type":"select","prompt":"Which location needs attention?","options":["Classroom","Library","Hall","Specialist room","Office","Other"]}'::jsonb, true),
    ('classroom_audio_issue', 'audio_device', 'Audio device', 2, '{"field_type":"select","prompt":"Which audio device is affected?","options":["Speakers","Microphone","Amplifier","Panel speakers","Headset","Other"]}'::jsonb, true),
    ('classroom_audio_issue', 'issue_type', 'Issue type', 3, '{"field_type":"select","prompt":"What is the main sound problem?","options":["No sound","Distorted sound","Feedback or echo","Volume too low","Microphone not detected","Intermittent sound","Other"]}'::jsonb, true),
    ('classroom_audio_issue', 'impact', 'Impact', 4, '{"field_type":"segment","prompt":"How many learners or staff are affected?","options":["One class","Multiple classes","Whole year level","Whole school"]}'::jsonb, true),
    ('classroom_audio_issue', 'settings_checked', 'Settings checked', 5, '{"field_type":"yes_no","prompt":"Have you checked volume, mute, and input settings?"}'::jsonb, false),
    ('classroom_audio_issue', 'access_notes', 'Access notes', 6, '{"field_type":"textarea","prompt":"Any access, supervision, or timing notes?"}'::jsonb, false),
    ('student_login_problem', 'user_type', 'User type', 1, '{"field_type":"select","prompt":"Who is affected?","options":["Student","Staff member","Shared class account","Visitor","Other"]}'::jsonb, true),
    ('student_login_problem', 'device_type', 'Device type', 2, '{"field_type":"select","prompt":"Which device is being used?","options":["Chromebook","iPad","Laptop","Desktop","Shared device","Other"]}'::jsonb, true),
    ('student_login_problem', 'service', 'Service', 3, '{"field_type":"select","prompt":"Which service is affected?","options":["Chromebook login","Google Workspace","Microsoft 365","Email","Learning platform","Other"]}'::jsonb, true),
    ('student_login_problem', 'issue_type', 'Issue type', 4, '{"field_type":"select","prompt":"What is happening?","options":["Password reset needed","Account locked","MFA issue","Profile not loading","Permissions issue","Sync problem","Other"]}'::jsonb, true),
    ('student_login_problem', 'impact', 'Impact', 5, '{"field_type":"segment","prompt":"How many people are affected?","options":["One person","Small group","One class","Multiple classes","Whole school"]}'::jsonb, true),
    ('student_login_problem', 'notes', 'Notes', 6, '{"field_type":"textarea","prompt":"Add any helpful details, error messages, or timing notes."}'::jsonb, false),
    ('staff_account_or_mfa_issue', 'user_type', 'User type', 1, '{"field_type":"select","prompt":"Who is affected?","options":["Teacher","Support staff","Leadership","Relief staff","Other"]}'::jsonb, true),
    ('staff_account_or_mfa_issue', 'service', 'Service', 2, '{"field_type":"select","prompt":"Which service is affected?","options":["Google Workspace","Microsoft 365","Email","Printing","Learning platform","Other"]}'::jsonb, true),
    ('staff_account_or_mfa_issue', 'issue_type', 'Issue type', 3, '{"field_type":"select","prompt":"What is the access issue?","options":["Password reset","Account locked","MFA prompt failing","App permissions","New account access","Device trust issue","Other"]}'::jsonb, true),
    ('staff_account_or_mfa_issue', 'impact', 'Impact', 4, '{"field_type":"segment","prompt":"How much work is blocked?","options":["Low impact","One class affected","Admin work blocked","School-wide"]}'::jsonb, true),
    ('staff_account_or_mfa_issue', 'mfa_device', 'MFA device', 5, '{"field_type":"select","prompt":"Which MFA method is being used?","options":["Authenticator app","Phone prompt","Security key","Email code","Not sure"]}'::jsonb, false),
    ('staff_account_or_mfa_issue', 'notes', 'Notes', 6, '{"field_type":"textarea","prompt":"Add any helpful details, error messages, or timing notes."}'::jsonb, false),
    ('classroom_submission_issue', 'platform', 'Platform', 1, '{"field_type":"select","prompt":"Which platform is affected?","options":["Google Classroom","Microsoft Teams","Learning portal","Shared drive","Other"]}'::jsonb, true),
    ('classroom_submission_issue', 'issue_type', 'Issue type', 2, '{"field_type":"select","prompt":"What is the issue?","options":["Assignment missing","Submission not visible","Cannot join class","File will not open","Late notification","Wrong permissions","Sync problem","Other"]}'::jsonb, true),
    ('classroom_submission_issue', 'class_context', 'Class context', 3, '{"field_type":"select","prompt":"Which class context applies?","options":["One student","Small group","One class","Multiple classes","Whole year level","Staff only"]}'::jsonb, true),
    ('classroom_submission_issue', 'impact', 'Impact', 4, '{"field_type":"segment","prompt":"How disruptive is this right now?","options":["Minor","Moderate","Major","School-wide"]}'::jsonb, true),
    ('classroom_submission_issue', 'refresh_check', 'Refresh check', 5, '{"field_type":"yes_no","prompt":"Have you refreshed or reloaded the class page?"}'::jsonb, false),
    ('classroom_submission_issue', 'notes', 'Notes', 6, '{"field_type":"textarea","prompt":"Add any helpful details, error messages, or timing notes."}'::jsonb, false),
    ('website_or_filter_block', 'site_or_app', 'Site or app', 1, '{"field_type":"short_text","prompt":"Which website or app is blocked?"}'::jsonb, true),
    ('website_or_filter_block', 'blocker_type', 'Block type', 2, '{"field_type":"select","prompt":"What is blocking access?","options":["Site blocked incorrectly","Approval needed","Login blocked","Content filter issue","Certificate or browser issue","Other"]}'::jsonb, true),
    ('website_or_filter_block', 'device_type', 'Device type', 3, '{"field_type":"select","prompt":"Which device is affected?","options":["Chromebook","iPad","Laptop","Desktop","Phone","Other"]}'::jsonb, true),
    ('website_or_filter_block', 'class_context', 'Class context', 4, '{"field_type":"segment","prompt":"How many users are affected?","options":["One student","Small group","One class","Whole year level","Staff member"]}'::jsonb, true),
    ('website_or_filter_block', 'notes', 'Notes', 5, '{"field_type":"textarea","prompt":"Add the link, lesson context, or any error message."}'::jsonb, false),
    ('headset_or_mic_not_working', 'device_type', 'Device type', 1, '{"field_type":"select","prompt":"Which audio device is affected?","options":["Headset","USB microphone","Built-in microphone","Camera microphone","Speakers","Other"]}'::jsonb, true),
    ('headset_or_mic_not_working', 'issue_type', 'Issue type', 2, '{"field_type":"select","prompt":"What is the audio fault?","options":["Not detected","No sound","Low volume","Static or distortion","Echo or feedback","Cable fault","Other"]}'::jsonb, true),
    ('headset_or_mic_not_working', 'app_context', 'App context', 3, '{"field_type":"select","prompt":"Where is it being used?","options":["Google Meet","Microsoft Teams","Recording","Reading app","Classroom activity","Other"]}'::jsonb, true),
    ('headset_or_mic_not_working', 'tested_elsewhere', 'Tested elsewhere', 4, '{"field_type":"yes_no","prompt":"Have you tested it on another device?"}'::jsonb, false),
    ('headset_or_mic_not_working', 'notes', 'Notes', 5, '{"field_type":"textarea","prompt":"Add any helpful details, error messages, or timing notes."}'::jsonb, false),
    ('charger_or_cable_fault', 'device_type', 'Device type', 1, '{"field_type":"select","prompt":"Which charger or cable is affected?","options":["Chromebook charger","Laptop charger","iPad charger","USB-C cable","HDMI cable","Ethernet cable","Adapter","Other"]}'::jsonb, true),
    ('charger_or_cable_fault', 'issue_type', 'Issue type', 2, '{"field_type":"select","prompt":"What is wrong with it?","options":["Not charging","Intermittent connection","Damaged cable","Missing charger","Loose port","Other"]}'::jsonb, true),
    ('charger_or_cable_fault', 'asset_tag_or_room', 'Asset tag or room', 3, '{"field_type":"short_text","prompt":"Add the asset tag, room, or storage location if known."}'::jsonb, false),
    ('charger_or_cable_fault', 'tried_swap', 'Swap test', 4, '{"field_type":"yes_no","prompt":"Have you tried a known good charger or cable?"}'::jsonb, false),
    ('charger_or_cable_fault', 'notes', 'Notes', 5, '{"field_type":"textarea","prompt":"Add any helpful details, error messages, or timing notes."}'::jsonb, false)
) as s(template_code, step_key, label, sort_order, config, required)
  on s.template_code = t.code
on conflict (template_id, step_key) do update
set label = excluded.label,
    sort_order = excluded.sort_order,
    config = excluded.config,
    required = excluded.required;

insert into public.rm_ticket_categories (code, name, sort_order)
values
  ('classrooms_offices', 'Classrooms / offices', 9),
  ('site_security', 'Site security', 10),
  ('sports_grounds', 'Sports / grounds', 11)
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'classroom_fitout_damage', 'Classroom fit-out damage', 'Broken desks, chairs, shelves, whiteboards, and fixed classroom fittings.', 1, true
from public.rm_ticket_categories c
where c.code = 'classrooms_offices'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'storage_or_furniture_issue', 'Storage or furniture issue', 'Damaged cupboards, shelving, storage, and loose furniture.', 1, true
from public.rm_ticket_categories c
where c.code = 'classrooms_offices'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'door_lock_or_access_issue', 'Door lock or access issue', 'Locks, closers, handles, and room access problems.', 1, true
from public.rm_ticket_categories c
where c.code = 'site_security'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'gate_or_entry_issue', 'Gate or entry issue', 'Gate, entryway, and external access faults.', 1, true
from public.rm_ticket_categories c
where c.code = 'site_security'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'playground_or_field_hazard', 'Playground or field hazard', 'Surface hazards, damaged equipment, and outdoor safety concerns.', 1, true
from public.rm_ticket_categories c
where c.code = 'sports_grounds'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'drainage_or_surface_issue', 'Drainage or surface issue', 'Pooling water, blocked drains, potholes, and trip hazards.', 1, true
from public.rm_ticket_categories c
where c.code = 'sports_grounds'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'toilet_or_washroom_supply_issue', 'Toilet or washroom supply issue', 'Supplies, blockages, smells, and washroom hygiene problems.', 1, true
from public.rm_ticket_categories c
where c.code = 'toilets_washrooms'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'heating_or_ventilation_outage', 'Heating or ventilation outage', 'Heating, cooling, ventilation, and air movement issues.', 1, true
from public.rm_ticket_categories c
where c.code = 'heating_ventilation'
on conflict (code) do nothing;

insert into public.rm_ticket_template_steps (template_id, step_key, label, sort_order, config, required)
select t.id, s.step_key, s.label, s.sort_order, s.config, s.required
from public.rm_ticket_templates t
join (
  values
    ('classroom_fitout_damage', 'location', 'Location', 1, '{"field_type":"select","prompt":"Which location needs attention?","options":["Classroom","Office","Library","Hall","Staff room","Specialist room","Other"]}'::jsonb, true),
    ('classroom_fitout_damage', 'asset_area', 'Asset / area', 2, '{"field_type":"select","prompt":"What asset or fitting is affected?","options":["Desk","Chair","Whiteboard","Cupboard","Shelf","Blind","Pinboard","Other"]}'::jsonb, true),
    ('classroom_fitout_damage', 'issue_type', 'Issue type', 3, '{"field_type":"select","prompt":"What is the main fault?","options":["Broken","Loose","Missing fixings","Surface damage","Sticking","Needs replacement","Other"]}'::jsonb, true),
    ('classroom_fitout_damage', 'safety_risk', 'Safety risk', 4, '{"field_type":"segment","prompt":"How urgent is the safety risk?","options":["No risk","Minor","Moderate","High","Immediate"]}'::jsonb, true),
    ('classroom_fitout_damage', 'access_notes', 'Access notes', 5, '{"field_type":"textarea","prompt":"Any access, supervision, or timing notes?"}'::jsonb, false),
    ('storage_or_furniture_issue', 'location', 'Location', 1, '{"field_type":"select","prompt":"Which location needs attention?","options":["Classroom","Office","Library","Hall","Staff room","Specialist room","Other"]}'::jsonb, true),
    ('storage_or_furniture_issue', 'asset_area', 'Asset / area', 2, '{"field_type":"select","prompt":"What storage or furniture is affected?","options":["Cupboard","Shelf","Table","Chair","Drawer","Locker","Bench","Other"]}'::jsonb, true),
    ('storage_or_furniture_issue', 'issue_type', 'Issue type', 3, '{"field_type":"select","prompt":"What is the main fault?","options":["Broken","Loose","Won''t open","Won''t close","Sharp edge","Needs removal","Other"]}'::jsonb, true),
    ('storage_or_furniture_issue', 'safety_risk', 'Safety risk', 4, '{"field_type":"segment","prompt":"How urgent is the safety risk?","options":["No risk","Minor","Moderate","High","Immediate"]}'::jsonb, true),
    ('storage_or_furniture_issue', 'notes', 'Notes', 5, '{"field_type":"textarea","prompt":"Add any helpful details, access needs, or timing notes."}'::jsonb, false),
    ('door_lock_or_access_issue', 'location', 'Location', 1, '{"field_type":"select","prompt":"Which location needs attention?","options":["Main entrance","Classroom door","Gate","Store room","Fence","Other"]}'::jsonb, true),
    ('door_lock_or_access_issue', 'hardware', 'Hardware', 2, '{"field_type":"select","prompt":"Which part is affected?","options":["Lock","Latch","Door closer","Handle","Key","Gate catch","Intercom","Other"]}'::jsonb, true),
    ('door_lock_or_access_issue', 'issue_type', 'Issue type', 3, '{"field_type":"select","prompt":"What is the access fault?","options":["Won''t lock","Won''t close","Jammed","Damaged","Missing key","Access issue","Other"]}'::jsonb, true),
    ('door_lock_or_access_issue', 'security_risk', 'Security risk', 4, '{"field_type":"segment","prompt":"How urgent is the security risk?","options":["Low","Medium","High","Immediate"]}'::jsonb, true),
    ('door_lock_or_access_issue', 'notes', 'Notes', 5, '{"field_type":"textarea","prompt":"Add any helpful details, access needs, or timing notes."}'::jsonb, false),
    ('gate_or_entry_issue', 'location', 'Location', 1, '{"field_type":"select","prompt":"Which location needs attention?","options":["Main entrance","Classroom door","Gate","Store room","Fence","Other"]}'::jsonb, true),
    ('gate_or_entry_issue', 'hardware', 'Hardware', 2, '{"field_type":"select","prompt":"Which part is affected?","options":["Gate","Door","Closer","Latch","Lock","Intercom","Other"]}'::jsonb, true),
    ('gate_or_entry_issue', 'issue_type', 'Issue type', 3, '{"field_type":"select","prompt":"What is the access fault?","options":["Won''t lock","Won''t close","Jammed","Damaged","Key issue","Access issue","Other"]}'::jsonb, true),
    ('gate_or_entry_issue', 'security_risk', 'Security risk', 4, '{"field_type":"segment","prompt":"How urgent is the security risk?","options":["Low","Medium","High","Immediate"]}'::jsonb, true),
    ('gate_or_entry_issue', 'notes', 'Notes', 5, '{"field_type":"textarea","prompt":"Add any helpful details, access needs, or timing notes."}'::jsonb, false),
    ('playground_or_field_hazard', 'location', 'Location', 1, '{"field_type":"select","prompt":"Which outdoor area needs attention?","options":["Playground","Field","Court","Pathway","Car park","Drain","Other"]}'::jsonb, true),
    ('playground_or_field_hazard', 'hazard_type', 'Hazard type', 2, '{"field_type":"select","prompt":"What is the main hazard?","options":["Pothole","Trip hazard","Broken surfacing","Loose gravel","Water pooling","Damaged fence","Equipment damage","Other"]}'::jsonb, true),
    ('playground_or_field_hazard', 'surface_type', 'Surface type', 3, '{"field_type":"select","prompt":"What surface is affected?","options":["Concrete","Asphalt","Grass","Synthetic","Mulch","Gravel","Other"]}'::jsonb, false),
    ('playground_or_field_hazard', 'impact', 'Impact', 4, '{"field_type":"segment","prompt":"How many users are affected?","options":["One area","Multiple users","Whole school","After-hours only"]}'::jsonb, true),
    ('playground_or_field_hazard', 'barrier_needed', 'Barrier needed', 5, '{"field_type":"yes_no","prompt":"Does the area need to be blocked off?"}'::jsonb, false),
    ('playground_or_field_hazard', 'notes', 'Notes', 6, '{"field_type":"textarea","prompt":"Add any helpful details, weather notes, or timing notes."}'::jsonb, false),
    ('drainage_or_surface_issue', 'location', 'Location', 1, '{"field_type":"select","prompt":"Which outdoor area needs attention?","options":["Playground","Field","Court","Pathway","Car park","Drain","Other"]}'::jsonb, true),
    ('drainage_or_surface_issue', 'hazard_type', 'Hazard type', 2, '{"field_type":"select","prompt":"What is the main issue?","options":["Pooling water","Blocked drain","Pothole","Cracked surface","Loose gravel","Mud buildup","Other"]}'::jsonb, true),
    ('drainage_or_surface_issue', 'weather_pattern', 'Weather pattern', 3, '{"field_type":"select","prompt":"When is it happening?","options":["After rain","Ongoing","Dry weather","Unknown"]}'::jsonb, false),
    ('drainage_or_surface_issue', 'impact', 'Impact', 4, '{"field_type":"segment","prompt":"How disruptive is this right now?","options":["Minor","Moderate","Major","Immediate hazard"]}'::jsonb, true),
    ('drainage_or_surface_issue', 'notes', 'Notes', 5, '{"field_type":"textarea","prompt":"Add any helpful details, weather notes, or timing notes."}'::jsonb, false),
    ('toilet_or_washroom_supply_issue', 'location', 'Location', 1, '{"field_type":"select","prompt":"Which washroom area needs attention?","options":["Student block","Staff toilet","Accessible toilet","Changing room","Other"]}'::jsonb, true),
    ('toilet_or_washroom_supply_issue', 'issue_type', 'Issue type', 2, '{"field_type":"select","prompt":"What is the main problem?","options":["Blocked toilet","Broken flush","Leak","Odour","No soap","No paper","Sink blocked","Tap issue","Other"]}'::jsonb, true),
    ('toilet_or_washroom_supply_issue', 'supplies_affected', 'Supplies affected', 3, '{"field_type":"select","prompt":"Which supplies or fixtures are affected?","options":["Soap","Paper towels","Toilet paper","Hand dryer","Bin","None","Other"]}'::jsonb, false),
    ('toilet_or_washroom_supply_issue', 'facilities_affected', 'Facilities affected', 4, '{"field_type":"segment","prompt":"How much of the area is affected?","options":["One cubicle","Multiple cubicles","Whole block","Staff only","Student area"]}'::jsonb, true),
    ('toilet_or_washroom_supply_issue', 'hygiene_risk', 'Hygiene risk', 5, '{"field_type":"segment","prompt":"How urgent is the hygiene risk?","options":["Low","Medium","High","Immediate"]}'::jsonb, true),
    ('toilet_or_washroom_supply_issue', 'notes', 'Notes', 6, '{"field_type":"textarea","prompt":"Add any helpful details, cleaning needs, or timing notes."}'::jsonb, false),
    ('heating_or_ventilation_outage', 'location', 'Location', 1, '{"field_type":"select","prompt":"Which location needs attention?","options":["Classroom","Office","Library","Hall","Staff room","Specialist room","Other"]}'::jsonb, true),
    ('heating_or_ventilation_outage', 'system', 'System', 2, '{"field_type":"select","prompt":"Which system is affected?","options":["Heater","Heat pump","Fan","Window vent","Exhaust fan","Thermostat","Other"]}'::jsonb, true),
    ('heating_or_ventilation_outage', 'issue_type', 'Issue type', 3, '{"field_type":"select","prompt":"What is happening?","options":["Not heating","Too hot","Too cold","No airflow","Noisy","Smell or dust","Other"]}'::jsonb, true),
    ('heating_or_ventilation_outage', 'time_of_day', 'Time of day', 4, '{"field_type":"select","prompt":"When is the issue most noticeable?","options":["Morning","Midday","Afternoon","All day","Intermittent"]}'::jsonb, false),
    ('heating_or_ventilation_outage', 'impact', 'Impact', 5, '{"field_type":"segment","prompt":"How disruptive is this right now?","options":["Minor","Moderate","Major","Immediate"]}'::jsonb, true),
    ('heating_or_ventilation_outage', 'notes', 'Notes', 6, '{"field_type":"textarea","prompt":"Add any helpful details, weather notes, or timing notes."}'::jsonb, false)
) as s(template_code, step_key, label, sort_order, config, required)
  on s.template_code = t.code
on conflict (template_id, step_key) do update
set label = excluded.label,
    sort_order = excluded.sort_order,
    config = excluded.config,
    required = excluded.required;
