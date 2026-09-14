-- School Management System - Database Schema
-- Run with `supabase db push`

-- Students table
create table if not exists public.students (
  id uuid default gen_random_uuid() primary key,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  date_of_birth date,
  grade_level text,
  class_id uuid,
  parent_name text,
  parent_phone text,
  enrollment_date date default current_date,
  status text default 'active' check (status in ('active', 'inactive', 'graduated', 'transferred')),
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- Classes table
create table if not exists public.classes (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  grade_level text,
  subject text,
  room_number text,
  capacity integer,
  school_year text,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- Staff table
create table if not exists public.staff (
  id uuid default gen_random_uuid() primary key,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  role text,
  department text,
  hire_date date,
  status text default 'active' check (status in ('active', 'inactive', 'on_leave')),
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- Assets table
create table if not exists public.assets (
  id uuid default gen_random_uuid() primary key,
  asset_tag text unique not null,
  name text not null,
  category text,
  model text,
  serial_number text,
  status text default 'available' check (status in ('available', 'in_use', 'maintenance', 'retired', 'lost')),
  assigned_to uuid,
  assigned_to_type text check (assigned_to_type in ('student', 'staff', 'class')),
  location text,
  purchase_date date,
  purchase_cost numeric,
  condition text check (condition in ('excellent', 'good', 'fair', 'poor')),
  notes text,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- Attendance table
create table if not exists public.attendance (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references public.students(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  date date not null,
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  notes text,
  created_at timestamp default now()
);

-- Subjects table
create table if not exists public.subjects (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  code text unique,
  description text,
  created_at timestamp default now()
);

-- Foreign keys
alter table public.students add constraint students_class_id_fkey foreign key (class_id) references public.classes(id) on delete set null;

-- Indexes
create index students_class_id_idx on public.students (class_id);
create index students_status_idx on public.students (status);
create index attendance_student_id_idx on public.attendance (student_id);
create index attendance_class_id_idx on public.attendance (class_id);
create index attendance_date_idx on public.attendance (date);
create index assets_assigned_to_idx on public.assets (assigned_to);
create index assets_status_idx on public.assets (status);

-- RLS
alter table public.students enable row level security;
alter table public.classes enable row level security;
alter table public.staff enable row level security;
alter table public.assets enable row level security;
alter table public.attendance enable row level security;
alter table public.subjects enable row level security;

-- Policies
create policy "Authenticated users can view students" on public.students for select using (auth.role() = 'authenticated');
create policy "Authenticated users can manage students" on public.students for all using (auth.role() = 'authenticated');

create policy "Authenticated users can view classes" on public.classes for select using (auth.role() = 'authenticated');
create policy "Authenticated users can manage classes" on public.classes for all using (auth.role() = 'authenticated');

create policy "Authenticated users can view staff" on public.staff for select using (auth.role() = 'authenticated');
create policy "Authenticated users can manage staff" on public.staff for all using (auth.role() = 'authenticated');

create policy "Authenticated users can view assets" on public.assets for select using (auth.role() = 'authenticated');
create policy "Authenticated users can manage assets" on public.assets for all using (auth.role() = 'authenticated');

create policy "Authenticated users can view attendance" on public.attendance for select using (auth.role() = 'authenticated');
create policy "Authenticated users can manage attendance" on public.attendance for all using (auth.role() = 'authenticated');

create policy "Authenticated users can view subjects" on public.subjects for select using (auth.role() = 'authenticated');
create policy "Authenticated users can manage subjects" on public.subjects for all using (auth.role() = 'authenticated');

-- Update timestamp trigger
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger students_updated_at before update on public.students for each row execute function update_updated_at_column();
create trigger classes_updated_at before update on public.classes for each row execute function update_updated_at_column();
create trigger staff_updated_at before update on public.staff for each row execute function update_updated_at_column();
create trigger assets_updated_at before update on public.assets for each row execute function update_updated_at_column();