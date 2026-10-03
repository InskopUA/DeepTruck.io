alter table public.carrier_verification_requests
  add column if not exists shipper_user_id uuid references auth.users(id) on delete set null;

create index if not exists carrier_verification_requests_shipper_user_id_idx
  on public.carrier_verification_requests (shipper_user_id, created_at desc);
