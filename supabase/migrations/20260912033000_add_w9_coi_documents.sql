alter table public.carrier_verification_requests
  add column if not exists w9_uploaded boolean not null default false,
  add column if not exists w9_bucket text,
  add column if not exists w9_path text,
  add column if not exists w9_file_name text,
  add column if not exists coi_uploaded boolean not null default false,
  add column if not exists coi_bucket text,
  add column if not exists coi_path text,
  add column if not exists coi_file_name text;
