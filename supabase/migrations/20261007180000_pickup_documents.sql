-- Pickup files are private. Only the Edge API can issue document access;
-- driver access belongs to the accepted Auth user, never just a phone number.
alter table public.tracking_loads
  add column pickup_latitude double precision check (pickup_latitude between -90 and 90),
  add column pickup_longitude double precision check (pickup_longitude between -180 and 180),
  add column documents_unlocked_at timestamptz,
  add column documents_unlock_method text check (documents_unlock_method in ('arrival','manual')),
  add constraint tracking_pickup_coordinate_pair check ((pickup_latitude is null) = (pickup_longitude is null));

create table public.tracking_documents (
  id uuid primary key,
  load_id uuid not null references public.tracking_loads(id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 180),
  kind text not null check (kind in ('gate_pass','release_form')),
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  byte_size integer not null check (byte_size between 1 and 10485760),
  object_path text not null unique,
  opened_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create index on public.tracking_documents (load_id, created_at);
alter table public.tracking_documents enable row level security;
revoke all on public.tracking_documents from anon, authenticated;
grant all on public.tracking_documents to service_role;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('pickup-documents','pickup-documents',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- No client Storage policies: neither a logged-in driver nor dealer can
-- bypass the load gate by requesting a storage path directly.
-- A restrictive guard also protects this bucket if other permissive Storage
-- policies were added through the dashboard for unrelated buckets.
create policy pickup_documents_require_server on storage.objects as restrictive
  for all to anon,authenticated
  using (bucket_id <> 'pickup-documents') with check (bucket_id <> 'pickup-documents');

create function public.tracking_pickup(p_shipper uuid,p_load uuid,p_address text,p_latitude double precision,p_longitude double precision)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.tracking_loads;
begin
  select * into v from public.tracking_loads where id=p_load and shipper_user_id=p_shipper for update;
  if not found then raise exception 'Load not found.' using errcode='42501'; end if;
  if v.status in ('completed','cancelled','declined') or v.expires_at <= clock_timestamp() then raise exception 'This load is closed.' using errcode='22023'; end if;
  if p_address is null or length(trim(p_address)) < 5 or length(p_address)>500 or p_latitude is null or p_longitude is null
    or not (p_latitude between -90 and 90) or not (p_longitude between -180 and 180) then
    raise exception 'Confirm the exact pickup address and map pin.' using errcode='22023';
  end if;
  if v.documents_unlocked_at is not null and (v.pickup_latitude is distinct from p_latitude or v.pickup_longitude is distinct from p_longitude or v.pickup_address is distinct from trim(p_address)) then
    raise exception 'Pickup cannot change after documents have been released.' using errcode='22023';
  end if;
  update public.tracking_loads set pickup_address=trim(p_address),pickup_latitude=p_latitude,pickup_longitude=p_longitude,updated_at=clock_timestamp() where id=p_load returning * into v;
  return to_jsonb(v);
end $$;

create function public.tracking_add_document(p_shipper uuid,p_load uuid,p_document uuid,p_name text,p_kind text,p_mime text,p_size integer,p_path text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.tracking_loads; d public.tracking_documents;
begin
  select * into v from public.tracking_loads where id=p_load and shipper_user_id=p_shipper for update;
  if not found then raise exception 'Load not found.' using errcode='42501'; end if;
  if v.status in ('completed','cancelled','declined') or v.expires_at<=clock_timestamp() then raise exception 'This load is closed.' using errcode='22023'; end if;
  if v.pickup_latitude is null or length(trim(v.pickup_address))<5 then raise exception 'Confirm the pickup location before uploading documents.' using errcode='22023'; end if;
  if p_path not like p_load::text || '/' || p_document::text || '/%' then raise exception 'Invalid document path.' using errcode='22023'; end if;
  select * into d from public.tracking_documents where id=p_document;
  if found then
    if d.load_id=p_load and d.object_path=p_path and d.file_name=p_name and d.kind=p_kind and d.mime_type=p_mime and d.byte_size=p_size then return d.id; end if;
    raise exception 'This document ID is already in use.' using errcode='22023';
  end if;
  if (select count(*) from public.tracking_documents where load_id=p_load)>=20 then raise exception 'Add no more than 20 pickup documents.' using errcode='22023'; end if;
  insert into public.tracking_documents(id,load_id,file_name,kind,mime_type,byte_size,object_path) values(p_document,p_load,p_name,p_kind,p_mime,p_size,p_path);
  return p_document;
end $$;

create function public.tracking_document_state(p_actor uuid,p_phone text,p_load uuid,p_driver boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.tracking_loads; x public.tracking_locations; v_open boolean; v_files jsonb; v_distance double precision;
begin
  select * into v from public.tracking_loads where id=p_load and
    ((not p_driver and shipper_user_id=p_actor) or (p_driver and (driver_user_id=p_actor or (driver_user_id is null and status='pending' and driver_phone=p_phone)))) for update;
  if not found then raise exception 'Load not found.' using errcode='42501'; end if;
  v_open := v.status not in ('completed','cancelled','declined') and v.expires_at>clock_timestamp();
  if v_open and v.status='active' and v.documents_unlocked_at is null and v.pickup_latitude is not null
    and exists(select 1 from public.tracking_documents where load_id=v.id) then
    -- Only fixes in this load's current consent period can release its files.
    select a.* into x from public.tracking_locations a where a.driver_user_id=v.driver_user_id
      and exists(select 1 from public.tracking_access_periods p where p.load_id=v.id and p.ended_at is null
        and a.captured_at>=p.started_at and a.captured_at<v.expires_at)
      order by a.captured_at desc limit 1;
    if found and x.captured_at between clock_timestamp()-interval '90 seconds' and clock_timestamp()
      and x.received_at>=clock_timestamp()-interval '90 seconds' and x.accuracy<=100 then
      v_distance := 6371000 * 2 * asin(sqrt(least(1.0,greatest(0.0,
        power(sin(radians(x.latitude-v.pickup_latitude)/2),2)
        +cos(radians(v.pickup_latitude))*cos(radians(x.latitude))*power(sin(radians(x.longitude-v.pickup_longitude)/2),2)))));
      -- Include uncertainty: a fix straddling the one-mile edge stays locked.
      if v_distance+x.accuracy<=1609.344 then
        update public.tracking_loads set documents_unlocked_at=clock_timestamp(),documents_unlock_method='arrival' where id=v.id returning * into v;
      end if;
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.file_name,'kind',d.kind,'mimeType',d.mime_type,'size',d.byte_size,'openedAt',d.opened_at) order by d.created_at),'[]'::jsonb)
    into v_files from public.tracking_documents d where d.load_id=v.id;
  return jsonb_build_object('documents',v_files,'unlockedAt',v.documents_unlocked_at,'unlockMethod',v.documents_unlock_method,
    'status',case when not v_open then 'closed' when v.documents_unlocked_at is null then 'locked' else 'available' end,
    'canOpen',v_open and v.documents_unlocked_at is not null and coalesce(v.driver_user_id=p_actor,false));
end $$;

create function public.tracking_document_states(p_actor uuid,p_phone text,p_loads uuid[],p_driver boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_result jsonb := '{}'::jsonb;
begin
  if cardinality(p_loads)>100 then raise exception 'Too many loads.' using errcode='22023'; end if;
  -- Consistent ordering also avoids deadlocks between concurrent batch reads.
  for v_id in select distinct unnest(p_loads) order by 1 loop
    v_result := v_result || jsonb_build_object(v_id::text,public.tracking_document_state(p_actor,p_phone,v_id,p_driver));
  end loop;
  return v_result;
end $$;

create function public.tracking_unlock_documents(p_shipper uuid,p_load uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.tracking_loads;
begin
  select * into v from public.tracking_loads where id=p_load and shipper_user_id=p_shipper for update;
  if not found then raise exception 'Load not found.' using errcode='42501'; end if;
  if v.status in ('completed','cancelled','declined') or v.expires_at<=clock_timestamp() then raise exception 'This load is closed.' using errcode='22023'; end if;
  if not exists(select 1 from public.tracking_documents where load_id=p_load) then raise exception 'Upload pickup documents first.' using errcode='22023'; end if;
  if v.documents_unlocked_at is null then
    update public.tracking_loads set documents_unlocked_at=clock_timestamp(),documents_unlock_method='manual' where id=p_load;
  end if;
  return public.tracking_document_state(p_shipper,'',p_load,false);
end $$;

create function public.tracking_document_access(p_actor uuid,p_phone text,p_load uuid,p_document uuid,p_driver boolean,p_opened boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_state jsonb; d public.tracking_documents;
begin
  v_state := public.tracking_document_state(p_actor,p_phone,p_load,p_driver);
  if p_driver and v_state->>'status'='closed' then raise exception 'Document access for this load is closed.' using errcode='42501'; end if;
  if p_driver and not (v_state->>'canOpen')::boolean then raise exception 'Documents are available at pickup, within 1 mile.' using errcode='42501'; end if;
  select * into d from public.tracking_documents where id=p_document and load_id=p_load;
  if not found then raise exception 'Document not found.' using errcode='22023'; end if;
  if p_driver and p_opened and d.opened_at is null then update public.tracking_documents set opened_at=clock_timestamp() where id=d.id returning * into d; end if;
  return to_jsonb(d);
end $$;

revoke all on function public.tracking_pickup(uuid,uuid,text,double precision,double precision),public.tracking_add_document(uuid,uuid,uuid,text,text,text,integer,text),public.tracking_document_state(uuid,text,uuid,boolean),public.tracking_document_states(uuid,text,uuid[],boolean),public.tracking_unlock_documents(uuid,uuid),public.tracking_document_access(uuid,text,uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.tracking_pickup(uuid,uuid,text,double precision,double precision),public.tracking_add_document(uuid,uuid,uuid,text,text,text,integer,text),public.tracking_document_state(uuid,text,uuid,boolean),public.tracking_document_states(uuid,text,uuid[],boolean),public.tracking_unlock_documents(uuid,uuid),public.tracking_document_access(uuid,text,uuid,uuid,boolean,boolean) to service_role;
