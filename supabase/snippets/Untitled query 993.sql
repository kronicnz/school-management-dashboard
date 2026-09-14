create table public.incidents (

id uuid default gen_random_uuid() primary key,

student_id uuid references public.students(id) not null,

created_by uuid references public.profiles(id) not null,

incident_details text not null,

severity text check (severity in ('low', 'medium', 'high', 'critical')),

is_deleted boolean default false, -- Soft delete for audit trails

created_at timestamp with time zone default timezone('utc'::text, now()) not null
);