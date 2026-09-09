-- OrbitFS Alert System v3
-- Dedicated configurable alert/notification dispatch with conditional recipient targeting.

insert into public.app_settings(key,value,category,public_read) values
  ('alerts.enabled','true'::jsonb,'alerts',false),
  ('alerts.manual_send_enabled','true'::jsonb,'alerts',false),
  ('alerts.realtime_enabled','true'::jsonb,'alerts',false),
  ('alerts.action_links_enabled','true'::jsonb,'alerts',false),
  ('alerts.default_type','"notification"'::jsonb,'alerts',false),
  ('alerts.default_severity','"info"'::jsonb,'alerts',false),
  ('alerts.default_audience','"selected"'::jsonb,'alerts',false),
  ('alerts.confirmation_threshold','25'::jsonb,'alerts',false),
  ('alerts.feed_limit','40'::jsonb,'alerts',false),
  ('alerts.max_message_length','4000'::jsonb,'alerts',false),
  ('alerts.type_notification_enabled','true'::jsonb,'alerts',false),
  ('alerts.type_message_enabled','true'::jsonb,'alerts',false),
  ('alerts.type_alert_enabled','true'::jsonb,'alerts',false),
  ('alerts.type_announcement_enabled','true'::jsonb,'alerts',false),
  ('alerts.type_maintenance_enabled','true'::jsonb,'alerts',false)
on conflict (key) do nothing;

create or replace function public.orbitfs_alert_candidate_recipients(
  p_audience text,
  p_recipient_user_ids uuid[] default null,
  p_conditions jsonb default '{}'::jsonb
) returns table(user_id uuid,surface text,label text,email text)
language sql security definer set search_path='public','auth' as $$
  select
    au.id as user_id,
    case when sm.user_id is not null and sm.status='active' then 'admin' else 'portal' end as surface,
    coalesce(
      nullif(btrim(up.display_name),''),
      nullif(btrim(concat_ws(' ',up.first_name,up.last_name)),''),
      au.email,
      au.id::text
    ) as label,
    au.email
  from auth.users au
  left join public.user_profiles up on up.id=au.id
  left join public.staff_members sm on sm.user_id=au.id
  where
    (
      (p_audience='selected' and au.id=any(coalesce(p_recipient_user_ids,'{}'::uuid[])))
      or (p_audience='staff' and sm.user_id is not null and sm.status='active')
      or (p_audience='customers' and up.id is not null and not (sm.user_id is not null and sm.status='active'))
      or (p_audience='everyone' and (up.id is not null or (sm.user_id is not null and sm.status='active')))
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'customer_status','')),'') is null
      or lower(coalesce(up.status,''))=lower(btrim(p_conditions->>'customer_status'))
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'country_code','')),'') is null
      or upper(coalesce(up.country_code,''))=upper(btrim(p_conditions->>'country_code'))
    )
    and (
      coalesce(p_conditions->>'verified_only','false')<>'true'
      or up.email_verified_at is not null
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'product_slug','')),'') is null
      or exists(
        select 1
        from public.orders o
        join public.order_items oi on oi.order_id=o.id
        where o.auth_user_id=au.id
          and lower(coalesce(oi.product_slug,''))=lower(btrim(p_conditions->>'product_slug'))
      )
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'service_status','')),'') is null
      or exists(
        select 1
        from public.orders o
        join public.order_items oi on oi.order_id=o.id
        where o.auth_user_id=au.id
          and lower(coalesce(oi.service_status,''))=lower(btrim(p_conditions->>'service_status'))
      )
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'license_state','')),'') is null
      or exists(
        select 1 from public.license_bindings lb
        where lb.auth_user_id=au.id
          and lb.archived_at is null
          and lower(coalesce(lb.remote_state,lb.desired_state,''))=lower(btrim(p_conditions->>'license_state'))
      )
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'staff_status','')),'') is null
      or lower(coalesce(sm.status,''))=lower(btrim(p_conditions->>'staff_status'))
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'staff_department','')),'') is null
      or lower(coalesce(sm.department,''))=lower(btrim(p_conditions->>'staff_department'))
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'staff_group','')),'') is null
      or exists(
        select 1
        from public.staff_member_groups smg
        join public.staff_groups sg on sg.id=smg.group_id
        where smg.user_id=au.id
          and lower(sg.slug)=lower(btrim(p_conditions->>'staff_group'))
      )
    );
$$;

revoke all on function public.orbitfs_alert_candidate_recipients(text,uuid[],jsonb) from public,anon,authenticated;

create or replace function public.orbitfs_alert_options() returns jsonb
language plpgsql security definer set search_path='public','auth' as $$
declare
  settings_json jsonb;
  products_json jsonb;
  customer_statuses_json jsonb;
  countries_json jsonb;
  service_statuses_json jsonb;
  license_states_json jsonb;
  staff_statuses_json jsonb;
  staff_departments_json jsonb;
  staff_groups_json jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.has_permission('notifications.send') then raise exception 'permission denied'; end if;

  select coalesce(jsonb_object_agg(replace(key,'alerts.',''),value),'{}'::jsonb)
    into settings_json from public.app_settings where category='alerts';

  select coalesce(jsonb_agg(jsonb_build_object('slug',slug,'name',name) order by name),'[]'::jsonb)
    into products_json from public.products where active=true;

  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) into customer_statuses_json
    from (select distinct status as v from public.user_profiles where nullif(btrim(status),'') is not null) q;
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) into countries_json
    from (select distinct upper(country_code) as v from public.user_profiles where nullif(btrim(country_code),'') is not null) q;
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) into service_statuses_json
    from (select distinct service_status as v from public.order_items where nullif(btrim(service_status),'') is not null) q;
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) into license_states_json
    from (
      select distinct remote_state as v from public.license_bindings where archived_at is null and nullif(btrim(remote_state),'') is not null
      union
      select distinct desired_state as v from public.license_bindings where archived_at is null and nullif(btrim(desired_state),'') is not null
    ) q;
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) into staff_statuses_json
    from (select distinct status as v from public.staff_members where nullif(btrim(status),'') is not null) q;
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) into staff_departments_json
    from (select distinct department as v from public.staff_members where nullif(btrim(department),'') is not null) q;
  select coalesce(jsonb_agg(jsonb_build_object('slug',slug,'name',name) order by sort_order,name),'[]'::jsonb)
    into staff_groups_json from public.staff_groups;

  return jsonb_build_object(
    'settings',settings_json,
    'products',products_json,
    'customer_statuses',customer_statuses_json,
    'countries',countries_json,
    'service_statuses',service_statuses_json,
    'license_states',license_states_json,
    'staff_statuses',staff_statuses_json,
    'staff_departments',staff_departments_json,
    'staff_groups',staff_groups_json
  );
end $$;

revoke all on function public.orbitfs_alert_options() from public,anon,authenticated;
grant execute on function public.orbitfs_alert_options() to authenticated;

create or replace function public.orbitfs_alert_preview(
  p_audience text,
  p_recipient_user_ids uuid[] default null,
  p_conditions jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path='public','auth' as $$
declare
  total integer:=0;
  sample_json jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.has_permission('notifications.send') then raise exception 'permission denied'; end if;
  if p_audience not in ('selected','customers','staff','everyone') then raise exception 'invalid audience'; end if;

  select count(*) into total
  from public.orbitfs_alert_candidate_recipients(p_audience,p_recipient_user_ids,coalesce(p_conditions,'{}'::jsonb));

  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into sample_json
  from (
    select user_id,surface,label,email
    from public.orbitfs_alert_candidate_recipients(p_audience,p_recipient_user_ids,coalesce(p_conditions,'{}'::jsonb))
    order by label,email
    limit 8
  ) x;

  return jsonb_build_object('count',total,'sample',sample_json);
end $$;

revoke all on function public.orbitfs_alert_preview(text,uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.orbitfs_alert_preview(text,uuid[],jsonb) to authenticated;

create or replace function public.orbitfs_alert_send(
  p_audience text,
  p_recipient_user_ids uuid[] default null,
  p_kind text default 'notification',
  p_title text default '',
  p_message text default '',
  p_severity text default 'info',
  p_action_url text default null,
  p_conditions jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path='public','auth' as $$
declare
  actor uuid:=auth.uid();
  dispatch_id uuid:=gen_random_uuid();
  sent integer:=0;
  r record;
  clean_title text:=btrim(coalesce(p_title,''));
  clean_message text:=btrim(coalesce(p_message,''));
  clean_action text:=nullif(btrim(coalesce(p_action_url,'')),'');
  actor_email text;
  system_enabled boolean:=true;
  manual_enabled boolean:=true;
  type_enabled boolean:=true;
  links_enabled boolean:=true;
  max_message integer:=4000;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if not public.has_permission('notifications.send') then raise exception 'permission denied'; end if;
  if p_audience not in ('selected','customers','staff','everyone') then raise exception 'invalid audience'; end if;
  if p_kind not in ('notification','message','alert','announcement','maintenance') then raise exception 'invalid alert type'; end if;
  if p_severity not in ('info','success','warning','error') then raise exception 'invalid severity'; end if;

  select coalesce((select (value#>>'{}')::boolean from public.app_settings where key='alerts.enabled'),true) into system_enabled;
  select coalesce((select (value#>>'{}')::boolean from public.app_settings where key='alerts.manual_send_enabled'),true) into manual_enabled;
  select coalesce((select (value#>>'{}')::boolean from public.app_settings where key='alerts.action_links_enabled'),true) into links_enabled;
  select coalesce((select (value#>>'{}')::boolean from public.app_settings where key='alerts.type_'||p_kind||'_enabled'),true) into type_enabled;
  select greatest(100,least(4000,coalesce((select (value#>>'{}')::integer from public.app_settings where key='alerts.max_message_length'),4000))) into max_message;

  if not system_enabled then raise exception 'OrbitFS Alert System is disabled'; end if;
  if not manual_enabled then raise exception 'manual alert sending is disabled'; end if;
  if not type_enabled then raise exception '% alerts are disabled',p_kind; end if;
  if clean_title='' then raise exception 'title is required'; end if;
  if length(clean_title)>160 then raise exception 'title is too long'; end if;
  if length(clean_message)>max_message then raise exception 'message exceeds configured limit of % characters',max_message; end if;
  if clean_action is not null and not links_enabled then raise exception 'alert action links are disabled'; end if;
  if clean_action is not null and (left(clean_action,1)<>'/' or left(clean_action,2)='//') then
    raise exception 'action path must be a local OrbitFS path';
  end if;
  if p_audience='selected' and coalesce(array_length(p_recipient_user_ids,1),0)=0 then
    raise exception 'select at least one recipient';
  end if;

  for r in
    select * from public.orbitfs_alert_candidate_recipients(
      p_audience,p_recipient_user_ids,coalesce(p_conditions,'{}'::jsonb)
    )
  loop
    perform public.notification_emit(
      r.user_id,
      r.surface,
      'orbitfs_alert',
      'orbitfs.alert.manual.'||p_kind,
      clean_title,
      clean_message,
      p_severity,
      actor,
      'orbitfs_alert_dispatch',
      dispatch_id::text,
      clean_action,
      jsonb_build_object(
        'manual',true,
        'kind',p_kind,
        'dispatch_id',dispatch_id,
        'audience',p_audience,
        'conditions',coalesce(p_conditions,'{}'::jsonb)
      ),
      'orbitfs-alert-'||dispatch_id::text||'-'||r.user_id::text
    );
    sent:=sent+1;
  end loop;

  select email into actor_email from auth.users where id=actor;
  insert into public.admin_audit_log(actor_id,actor_email,action,target_type,target_id,detail)
  values(
    actor,actor_email,'orbitfs.alert.send','orbitfs_alert_dispatch',dispatch_id::text,
    jsonb_build_object(
      'audience',p_audience,
      'kind',p_kind,
      'severity',p_severity,
      'title',clean_title,
      'action_url',clean_action,
      'conditions',coalesce(p_conditions,'{}'::jsonb),
      'sent',sent,
      'selected_count',coalesce(array_length(p_recipient_user_ids,1),0)
    )
  );

  return jsonb_build_object('ok',true,'dispatch_id',dispatch_id,'sent',sent);
end $$;

revoke all on function public.orbitfs_alert_send(text,uuid[],text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.orbitfs_alert_send(text,uuid[],text,text,text,text,text,jsonb) to authenticated;

create or replace function public.orbitfs_alert_client_settings() returns jsonb
language plpgsql security definer set search_path='public','auth' as $$
declare
  enabled_value boolean:=true;
  realtime_value boolean:=true;
  feed_value integer:=40;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select coalesce((select (value#>>'{}')::boolean from public.app_settings where key='alerts.enabled'),true) into enabled_value;
  select coalesce((select (value#>>'{}')::boolean from public.app_settings where key='alerts.realtime_enabled'),true) into realtime_value;
  select greatest(10,least(100,coalesce((select (value#>>'{}')::integer from public.app_settings where key='alerts.feed_limit'),40))) into feed_value;
  return jsonb_build_object('enabled',enabled_value,'realtime_enabled',realtime_value,'feed_limit',feed_value);
end $$;

revoke all on function public.orbitfs_alert_client_settings() from public,anon,authenticated;
grant execute on function public.orbitfs_alert_client_settings() to authenticated;
