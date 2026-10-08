create table public.pickup_inspections (
  id uuid primary key,
  load_id uuid not null references public.tracking_loads(id) on delete cascade,
  document_id uuid not null unique references public.tracking_documents(id) on delete cascade,
  driver_user_id uuid not null references auth.users(id),
  status text not null default 'draft' check(status in ('draft','completed')),
  damages jsonb not null default '[]' check(jsonb_typeof(damages)='array' and jsonb_array_length(damages)<=40),
  catalog_version text not null,
  pdf_layout jsonb not null,
  revision integer not null default 1,
  preview_revision integer,
  annotated_path text,
  no_damage_observed boolean not null default false,
  share_key text not null unique check(share_key ~ '^[A-Za-z0-9_-]{22}$'),
  created_at timestamptz not null default clock_timestamp(),
  saved_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);
create index on public.pickup_inspections(load_id);
create table public.pickup_inspection_photos (
  id uuid primary key,
  inspection_id uuid not null references public.pickup_inspections(id) on delete cascade,
  damage_id uuid not null,
  object_path text not null unique,
  mime_type text not null check(mime_type in ('image/jpeg','image/png')),
  byte_size integer not null check(byte_size between 1 and 10485760),
  created_at timestamptz not null default clock_timestamp()
);
create index on public.pickup_inspection_photos(inspection_id,damage_id);

alter table public.pickup_inspections enable row level security;
alter table public.pickup_inspection_photos enable row level security;
revoke all on public.pickup_inspections,public.pickup_inspection_photos from anon,authenticated;
grant all on public.pickup_inspections,public.pickup_inspection_photos to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('inspection-photos','inspection-photos',false,10485760,array['image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy inspection_photos_require_server on storage.objects as restrictive for all to anon,authenticated
using(bucket_id <> 'inspection-photos') with check(bucket_id <> 'inspection-photos');

create function public.pickup_inspection_read(p_actor uuid,p_load uuid,p_document uuid,p_driver boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.pickup_inspections; v_photos jsonb;
begin
  perform public.tracking_document_access(p_actor,'',p_load,p_document,p_driver,false);
  select * into i from public.pickup_inspections where load_id=p_load and document_id=p_document;
  if not found then return null;end if;
  if p_driver and i.driver_user_id<>p_actor then raise exception 'Inspection not found.' using errcode='42501';end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at),'[]'::jsonb) into v_photos from public.pickup_inspection_photos p
    where p.inspection_id=i.id and exists(select 1 from jsonb_array_elements(i.damages) d where (d->>'id')::uuid=p.damage_id);
  return to_jsonb(i) || jsonb_build_object('photos',v_photos);
end $$;

create function public.pickup_inspection_save(p_actor uuid,p_load uuid,p_document uuid,p_id uuid,p_damages jsonb,p_revision integer,p_layout jsonb,p_share_key text,p_catalog text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.pickup_inspections; v_file jsonb;
begin
  v_file:=public.tracking_document_access(p_actor,'',p_load,p_document,true,false);
  if v_file->>'kind'<>'gate_pass' then raise exception 'Choose a gate pass for this vehicle.' using errcode='22023';end if;
  if jsonb_typeof(p_damages)<>'array' or jsonb_array_length(p_damages)>40 then raise exception 'Record no more than 40 damages.' using errcode='22023';end if;
  select * into i from public.pickup_inspections where document_id=p_document for update;
  if found then
    if i.id<>p_id or i.driver_user_id<>p_actor then raise exception 'Inspection not found.' using errcode='42501';end if;
    if i.status='completed' then return public.pickup_inspection_read(p_actor,p_load,p_document,true);end if;
    if i.revision<>p_revision then raise exception 'Inspection changed. Reload it before saving.' using errcode='22023';end if;
    update public.pickup_inspections set damages=p_damages,revision=revision+1,saved_at=clock_timestamp(),annotated_path=null,preview_revision=null where id=i.id;
  else
    if p_revision<>0 then raise exception 'Inspection changed. Reload it before saving.' using errcode='22023';end if;
    insert into public.pickup_inspections(id,load_id,document_id,driver_user_id,damages,pdf_layout,share_key,catalog_version)
    values(p_id,p_load,p_document,p_actor,p_damages,p_layout,p_share_key,p_catalog);
  end if;
  return public.pickup_inspection_read(p_actor,p_load,p_document,true);
end $$;

create function public.pickup_inspection_add_photo(p_actor uuid,p_load uuid,p_document uuid,p_photo uuid,p_damage uuid,p_path text,p_mime text,p_size integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.pickup_inspections; p public.pickup_inspection_photos;
begin
  perform public.tracking_document_access(p_actor,'',p_load,p_document,true,false);
  select * into i from public.pickup_inspections where document_id=p_document and load_id=p_load and driver_user_id=p_actor for update;
  if not found then raise exception 'Save the inspection before adding photos.' using errcode='22023';end if;
  if i.status<>'draft' then raise exception 'This inspection is already finished.' using errcode='22023';end if;
  if not exists(select 1 from jsonb_array_elements(i.damages) d where (d->>'id')::uuid=p_damage) then raise exception 'Damage not found.' using errcode='22023';end if;
  if p_path not like i.id::text || '/' || p_damage::text || '/' || p_photo::text || '/%' then raise exception 'Invalid photo path.' using errcode='22023';end if;
  select * into p from public.pickup_inspection_photos where id=p_photo;
  if found then
    if p.inspection_id<>i.id or p.damage_id<>p_damage or p.object_path<>p_path then raise exception 'Photo ID already in use.' using errcode='22023';end if;
  else
    if (select count(*) from public.pickup_inspection_photos where inspection_id=i.id and damage_id=p_damage)>=3 then raise exception 'Add no more than 3 photos per damage.' using errcode='22023';end if;
    insert into public.pickup_inspection_photos(id,inspection_id,damage_id,object_path,mime_type,byte_size) values(p_photo,i.id,p_damage,p_path,p_mime,p_size);
    update public.pickup_inspections set revision=revision+1,saved_at=clock_timestamp(),annotated_path=null,preview_revision=null where id=i.id;
  end if;
  return public.pickup_inspection_read(p_actor,p_load,p_document,true);
end $$;

create function public.pickup_inspection_publish(p_actor uuid,p_load uuid,p_document uuid,p_revision integer,p_path text,p_finish boolean,p_no_damage boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.pickup_inspections; d jsonb;
begin
  perform public.tracking_document_access(p_actor,'',p_load,p_document,true,false);
  select * into i from public.pickup_inspections where document_id=p_document and load_id=p_load and driver_user_id=p_actor for update;
  if not found then raise exception 'Inspection not found.' using errcode='22023';end if;
  if i.status='completed' then return public.pickup_inspection_read(p_actor,p_load,p_document,true);end if;
  if i.revision<>p_revision then raise exception 'Inspection changed. Review it again before finishing.' using errcode='22023';end if;
  if p_path not like p_load::text || '/' || p_document::text || '/inspection/' || i.id::text || '/%' then raise exception 'Invalid gate pass path.' using errcode='22023';end if;
  if jsonb_array_length(i.damages)=0 and not p_no_damage then raise exception 'Record damages or select No visible damage observed.' using errcode='22023';end if;
  for d in select value from jsonb_array_elements(i.damages) loop
    if not exists(select 1 from public.pickup_inspection_photos where inspection_id=i.id and damage_id=(d->>'id')::uuid) then raise exception 'Add a photo for each recorded damage.' using errcode='22023';end if;
  end loop;
  update public.pickup_inspections set annotated_path=p_path,preview_revision=revision,no_damage_observed=p_no_damage and jsonb_array_length(damages)=0,
    status=case when p_finish then 'completed' else 'draft' end,completed_at=case when p_finish then clock_timestamp() else null end where id=i.id;
  return public.pickup_inspection_read(p_actor,p_load,p_document,true);
end $$;

create function public.pickup_inspection_photo_access(p_actor uuid,p_load uuid,p_document uuid,p_photo uuid,p_driver boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare i jsonb; p public.pickup_inspection_photos;
begin
  i:=public.pickup_inspection_read(p_actor,p_load,p_document,p_driver);
  select * into p from public.pickup_inspection_photos where id=p_photo and inspection_id=(i->>'id')::uuid
    and exists(select 1 from jsonb_array_elements(i->'damages') d where (d->>'id')::uuid=damage_id);
  if not found then raise exception 'Photo not found.' using errcode='42501';end if;
  return to_jsonb(p);
end $$;

create function public.pickup_inspection_gallery(p_key text,p_photo uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.pickup_inspections; v_photo public.pickup_inspection_photos; v_photos jsonb;
begin
  select * into i from public.pickup_inspections where share_key=p_key and status='completed';
  if not found then raise exception 'Inspection not found.' using errcode='42501';end if;
  if p_photo is not null then
    select * into v_photo from public.pickup_inspection_photos where id=p_photo and inspection_id=i.id
      and exists(select 1 from jsonb_array_elements(i.damages) d where (d->>'id')::uuid=damage_id);
    if not found then raise exception 'Photo not found.' using errcode='42501';end if;
    return to_jsonb(v_photo);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'damageId',p.damage_id) order by p.created_at),'[]'::jsonb) into v_photos
    from public.pickup_inspection_photos p where p.inspection_id=i.id and exists(select 1 from jsonb_array_elements(i.damages) d where (d->>'id')::uuid=p.damage_id);
  -- A stable printed link exposes this completed damage record only. No gate
  -- pass, release barcode, dealer/driver contact details or storage paths.
  return jsonb_build_object('damages',i.damages,'photos',v_photos,'completedAt',i.completed_at);
end $$;

revoke all on function public.pickup_inspection_read(uuid,uuid,uuid,boolean),public.pickup_inspection_save(uuid,uuid,uuid,uuid,jsonb,integer,jsonb,text,text),public.pickup_inspection_add_photo(uuid,uuid,uuid,uuid,uuid,text,text,integer),public.pickup_inspection_publish(uuid,uuid,uuid,integer,text,boolean,boolean),public.pickup_inspection_photo_access(uuid,uuid,uuid,uuid,boolean),public.pickup_inspection_gallery(text,uuid) from public,anon,authenticated;
grant execute on function public.pickup_inspection_read(uuid,uuid,uuid,boolean),public.pickup_inspection_save(uuid,uuid,uuid,uuid,jsonb,integer,jsonb,text,text),public.pickup_inspection_add_photo(uuid,uuid,uuid,uuid,uuid,text,text,integer),public.pickup_inspection_publish(uuid,uuid,uuid,integer,text,boolean,boolean),public.pickup_inspection_photo_access(uuid,uuid,uuid,uuid,boolean),public.pickup_inspection_gallery(text,uuid) to service_role;

create or replace function public.tracking_document_state(p_actor uuid,p_phone text,p_load uuid,p_driver boolean)
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
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.file_name,'kind',d.kind,'mimeType',d.mime_type,'size',d.byte_size,'openedAt',d.opened_at,'inspection',(select jsonb_build_object('id',i.id,'status',i.status,'damageCount',jsonb_array_length(i.damages),'completedAt',i.completed_at) from public.pickup_inspections i where i.document_id=d.id)) order by d.created_at),'[]'::jsonb)
    into v_files from public.tracking_documents d where d.load_id=v.id;
  return jsonb_build_object('documents',v_files,'unlockedAt',v.documents_unlocked_at,'unlockMethod',v.documents_unlock_method,
    'status',case when not v_open then 'closed' when v.documents_unlocked_at is null then 'locked' else 'available' end,
    'canOpen',v_open and v.documents_unlocked_at is not null and coalesce(v.driver_user_id=p_actor,false));
end $$;
