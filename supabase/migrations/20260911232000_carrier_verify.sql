create table if not exists public.carrier_verification_requests (
  id uuid primary key default gen_random_uuid(),
  dot text not null,
  carrier_name text not null,
  email text not null,
  phone text not null,
  mc text,
  status text not null default 'pending',
  email_verified boolean not null default false,
  phone_verified boolean not null default false,
  license_uploaded boolean not null default false,
  sms_code_hash text not null,
  license_bucket text,
  license_path text,
  license_file_name text,
  verification_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists carrier_verification_requests_dot_idx
  on public.carrier_verification_requests (dot);

create index if not exists carrier_verification_requests_created_at_idx
  on public.carrier_verification_requests (created_at desc);

alter table public.carrier_verification_requests enable row level security;

create policy "service role manages carrier verification requests"
on public.carrier_verification_requests
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

insert into storage.buckets (id, name, public)
values ('driver-licenses', 'driver-licenses', false)
on conflict (id) do nothing;
