-- Coordinates are a single driver stream. Access periods decide which load
-- can see each point; accepting an invitation does not start sharing.
create table public.tracking_loads (
  id uuid primary key default gen_random_uuid(),
  shipper_user_id uuid not null references auth.users(id),
  verification_id uuid not null references public.carrier_verification_requests(id),
  client_request_id uuid not null,
  dealer_name text not null,
  carrier_name text not null,
  carrier_dot text not null,
  driver_name text not null check (length(driver_name) between 1 and 120),
  driver_phone text not null check (driver_phone ~ '^\+[1-9][0-9]{7,14}$'),
  driver_user_id uuid references auth.users(id),
  title text not null check (length(title) between 1 and 160),
  vehicles jsonb not null default '[]' check (jsonb_typeof(vehicles) = 'array' and jsonb_array_length(vehicles) <= 50),
  pickup_address text not null default '',
  delivery_address text not null default '',
  planned_at timestamptz,
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','accepted','active','paused','completed','cancelled','declined')),
  accepted_at timestamptz,
  completed_at timestamptz,
  invitation_status text not null default 'not_sent' check (invitation_status in ('not_sent','sent','failed')),
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shipper_user_id, client_request_id)
);
create index on public.tracking_loads (shipper_user_id, created_at desc);
create index on public.tracking_loads (driver_phone) where driver_user_id is null and status = 'pending';
create index on public.tracking_loads (driver_user_id, status);

create table public.tracking_access_periods (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.tracking_loads(id) on delete cascade,
  driver_user_id uuid not null references auth.users(id),
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
create unique index on public.tracking_access_periods (load_id) where ended_at is null;
create index on public.tracking_access_periods (driver_user_id, started_at);

create table public.tracking_locations (
  id uuid primary key,
  driver_user_id uuid not null references auth.users(id),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy double precision not null check (accuracy between 0 and 10000),
  captured_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp()
);
create index on public.tracking_locations (driver_user_id, captured_at desc);
create table public.tracking_sms_attempts (
  id bigint generated always as identity primary key,
  load_id uuid not null references public.tracking_loads(id) on delete cascade,
  shipper_user_id uuid not null references auth.users(id),
  driver_phone text not null,
  attempted_at timestamptz not null default clock_timestamp()
);
create index on public.tracking_sms_attempts (driver_phone, attempted_at);
create index on public.tracking_sms_attempts (shipper_user_id, attempted_at);

alter table public.tracking_loads enable row level security;
alter table public.tracking_access_periods enable row level security;
alter table public.tracking_locations enable row level security;
alter table public.tracking_sms_attempts enable row level security;
revoke all on public.tracking_loads, public.tracking_access_periods, public.tracking_locations, public.tracking_sms_attempts from anon, authenticated;
grant all on public.tracking_loads, public.tracking_access_periods, public.tracking_locations, public.tracking_sms_attempts to service_role;
grant usage, select on sequence public.tracking_sms_attempts_id_seq to service_role;

create function public.tracking_create(p_shipper uuid, p_verification uuid, p_request uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_verification public.carrier_verification_requests; v_load public.tracking_loads; v_expiry timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_shipper::text, 0));
  select * into v_load from public.tracking_loads where shipper_user_id = p_shipper and client_request_id = p_request;
  if found then return jsonb_build_object('load', to_jsonb(v_load), 'created', false); end if;
  select * into v_verification from public.carrier_verification_requests where id = p_verification and shipper_user_id = p_shipper;
  if not found or not (v_verification.email_verified and v_verification.phone_verified and v_verification.license_uploaded and v_verification.w9_uploaded and v_verification.coi_uploaded) then
    raise exception 'Choose a completed carrier verification from your workspace.' using errcode = '42501';
  end if;
  if (select count(*) from public.tracking_loads where shipper_user_id = p_shipper and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many new loads. Please try again later.' using errcode = 'P0001';
  end if;
  v_expiry := (p_payload->>'expires_at')::timestamptz;
  if v_expiry is null or v_expiry <= now() + interval '5 minutes' or v_expiry > now() + interval '30 days' then
    raise exception 'Tracking must expire within 30 days.' using errcode = '22023';
  end if;
  if (p_payload->>'planned_at')::timestamptz >= v_expiry then raise exception 'Planned pickup must be before tracking expiry.' using errcode = '22023'; end if;
  insert into public.tracking_loads (shipper_user_id,verification_id,client_request_id,dealer_name,carrier_name,carrier_dot,driver_name,driver_phone,title,vehicles,pickup_address,delivery_address,planned_at,expires_at)
  values (p_shipper,p_verification,p_request,p_payload->>'dealer_name',v_verification.carrier_name,v_verification.dot,p_payload->>'driver_name',p_payload->>'driver_phone',p_payload->>'title',coalesce(p_payload->'vehicles','[]'),coalesce(p_payload->>'pickup_address',''),coalesce(p_payload->>'delivery_address',''),(p_payload->>'planned_at')::timestamptz,v_expiry)
  returning * into v_load;
  return jsonb_build_object('load', to_jsonb(v_load), 'created', true);
end $$;

-- Locking the same driver in actions and ingestion prevents a point arriving
-- concurrently with pause/completion from extending a closed access period.
create function public.tracking_action(p_actor uuid, p_phone text, p_load uuid, p_action text, p_driver boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.tracking_loads; v_driver uuid; v_now timestamptz;
begin
  select driver_user_id into v_driver from public.tracking_loads where id = p_load;
  if v_driver is not null then perform pg_advisory_xact_lock(hashtextextended(v_driver::text, 1));
  elsif p_driver then perform pg_advisory_xact_lock(hashtextextended(p_actor::text, 1)); end if;
  select * into v from public.tracking_loads where id = p_load for update;
  if not found then raise exception 'Load not found.' using errcode = '42501'; end if;
  if p_driver then
    if (v.driver_user_id = p_actor or (v.driver_user_id is null and v.driver_phone = p_phone)) is not true then
      raise exception 'Load not found.' using errcode = '42501';
    end if;
  elsif v.shipper_user_id <> p_actor then raise exception 'Load not found.' using errcode = '42501'; end if;
  if v.status in ('completed','cancelled','declined') then
    if v.status = p_action or (p_action = 'complete' and v.status = 'completed') or (p_action = 'cancel' and v.status = 'cancelled') then return to_jsonb(v); end if;
    raise exception 'This load is already closed.' using errcode = '22023';
  end if;
  v_now := clock_timestamp();
  if v.expires_at <= v_now then raise exception 'Tracking access has expired.' using errcode = '22023'; end if;
  if p_action = 'accept' and p_driver and v.status = 'pending' then
    v.status := 'accepted'; v.driver_user_id := p_actor; v.accepted_at := v_now;
  elsif p_action = 'decline' and p_driver and v.status = 'pending' then
    v.status := 'declined'; v.driver_user_id := p_actor;
  elsif p_action = 'start' and p_driver and v.status in ('accepted','paused') then
    if v.driver_user_id is distinct from p_actor then raise exception 'Accept the invitation first.' using errcode = '42501'; end if;
    v.status := 'active';
    insert into public.tracking_access_periods (load_id,driver_user_id,started_at) values (v.id,p_actor,v_now);
  elsif p_action = 'start' and p_driver and v.status = 'active' then return to_jsonb(v);
  elsif p_action = 'pause' and p_driver and v.status = 'active' then v.status := 'paused';
  elsif p_action = 'pause' and p_driver and v.status = 'paused' then return to_jsonb(v);
  elsif p_action = 'complete' and v.status in ('accepted','active','paused') then v.status := 'completed'; v.completed_at := v_now;
  elsif p_action = 'cancel' and not p_driver then v.status := 'cancelled'; v.completed_at := v_now;
  else raise exception 'This action is not available for this load.' using errcode = '22023'; end if;
  if v.status <> 'active' then
    update public.tracking_access_periods set ended_at = greatest(started_at, least(v_now,v.expires_at)) where load_id = v.id and ended_at is null;
  end if;
  update public.tracking_loads set status = v.status,driver_user_id = v.driver_user_id,accepted_at = v.accepted_at,completed_at = v.completed_at,updated_at = v_now where id = v.id returning * into v;
  return to_jsonb(v);
end $$;

create function public.tracking_pause_all(p_driver uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_driver::text, 1)); v_now := clock_timestamp();
  update public.tracking_access_periods p set ended_at = greatest(p.started_at, least(v_now,l.expires_at)) from public.tracking_loads l where p.load_id = l.id and p.driver_user_id = p_driver and p.ended_at is null;
  update public.tracking_loads set status = 'paused', updated_at = v_now where driver_user_id = p_driver and status = 'active';
end $$;

create function public.tracking_ingest(p_driver uuid, p_points jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_point jsonb; v_at timestamptz; v_count integer := 0; v_active integer;
begin
  if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) > 100 then raise exception 'Invalid location batch.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_driver::text, 1));
  select count(*) into v_active from public.tracking_loads where driver_user_id = p_driver and status = 'active' and expires_at > clock_timestamp();
  -- Offline points may be delivered after completion, but only inside a
  -- previously granted period. A server receipt never grants new access.
  for v_point in select value from jsonb_array_elements(p_points) loop
    v_at := (v_point->>'captured_at')::timestamptz;
    if v_at > clock_timestamp() or v_at < clock_timestamp() - interval '24 hours' then continue; end if;
    if not exists (select 1 from public.tracking_access_periods p join public.tracking_loads l on l.id = p.load_id where p.driver_user_id = p_driver and v_at >= p.started_at and v_at < least(coalesce(p.ended_at,'infinity'::timestamptz),l.expires_at)) then continue; end if;
    insert into public.tracking_locations (id,driver_user_id,latitude,longitude,accuracy,captured_at)
    values ((v_point->>'id')::uuid,p_driver,(v_point->>'latitude')::double precision,(v_point->>'longitude')::double precision,(v_point->>'accuracy')::double precision,v_at)
    on conflict (id) do nothing;
    if found then v_count := v_count + 1; end if;
  end loop;
  return jsonb_build_object('inserted',v_count,'activeLoads',v_active);
end $$;

create function public.tracking_points(p_shipper uuid, p_load uuid, p_limit integer default 500)
returns setof public.tracking_locations language sql security definer set search_path = public, pg_temp as $$
  select x.* from public.tracking_locations x
  where exists (select 1 from public.tracking_access_periods p join public.tracking_loads l on l.id = p.load_id
    where l.id = p_load and l.shipper_user_id = p_shipper and p.driver_user_id = x.driver_user_id
    and x.captured_at >= p.started_at and x.captured_at < least(coalesce(p.ended_at,'infinity'::timestamptz),l.expires_at))
  order by x.captured_at desc limit greatest(1,least(p_limit,500));
$$;

create function public.tracking_dealer_loads(p_shipper uuid)
returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('latest_location',
    (select to_jsonb(x) from public.tracking_locations x where x.driver_user_id = l.driver_user_id
      and exists (select 1 from public.tracking_access_periods p where p.load_id = l.id
        and x.captured_at >= p.started_at and x.captured_at < least(coalesce(p.ended_at,'infinity'::timestamptz),l.expires_at))
      order by x.captured_at desc limit 1)) order by l.created_at desc),'[]'::jsonb)
  from (select * from public.tracking_loads where shipper_user_id = p_shipper order by created_at desc limit 100) l;
$$;

create function public.tracking_claim_sms(p_shipper uuid, p_load uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.tracking_loads;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_shipper::text, 2));
  select * into v from public.tracking_loads where id = p_load and shipper_user_id = p_shipper for update;
  if not found or v.status <> 'pending' or v.expires_at <= clock_timestamp() then raise exception 'Invitation is no longer available.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v.driver_phone, 3));
  if exists (select 1 from public.tracking_sms_attempts where driver_phone = v.driver_phone and attempted_at > now() - interval '60 seconds')
    or (select count(*) from public.tracking_sms_attempts where driver_phone = v.driver_phone and attempted_at > now() - interval '1 hour') >= 3
    or (select count(*) from public.tracking_sms_attempts where shipper_user_id = p_shipper and attempted_at > now() - interval '1 hour') >= 20 then
    raise exception 'SMS limit reached. Please wait before sending another invitation.' using errcode = 'P0001';
  end if;
  insert into public.tracking_sms_attempts (load_id,shipper_user_id,driver_phone) values (v.id,p_shipper,v.driver_phone);
  return to_jsonb(v);
end $$;

revoke all on function public.tracking_create(uuid,uuid,uuid,jsonb), public.tracking_action(uuid,text,uuid,text,boolean), public.tracking_pause_all(uuid), public.tracking_ingest(uuid,jsonb), public.tracking_points(uuid,uuid,integer), public.tracking_dealer_loads(uuid), public.tracking_claim_sms(uuid,uuid) from public, anon, authenticated;
grant execute on function public.tracking_create(uuid,uuid,uuid,jsonb), public.tracking_action(uuid,text,uuid,text,boolean), public.tracking_pause_all(uuid), public.tracking_ingest(uuid,jsonb), public.tracking_points(uuid,uuid,integer), public.tracking_dealer_loads(uuid), public.tracking_claim_sms(uuid,uuid) to service_role;
