create table public.students (

id uuid default gen_random_uuid() primary key,

nsn text unique not null, -- NZ National Student Number

first_name text not null,

last_name text not null,

room_number text,

year_level integer check (year_level in (7, 8)), -- NZ Intermediate context

is_active boolean default true

);