-- OrbitFS notification centre v2
-- Adds secure admin-authored notifications/messages/alerts/announcements.

update public.staff_groups
set permissions=jsonb_set(coalesce(permissions,'{}'::jsonb),'{notifications.send}','true'::jsonb,true),
    updated_at=now()
where slug in ('admin','superadmin');

create or replace function public.notification_admin_recipient_options(p_query text default '') returns jsonb
language plpgsql security definer set search_path='public','auth' as $$
declare rows_json jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.has_permission('notifications.send') then raise exception 'permission denied'; end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.kind desc,x.label,x.email),'[]'::jsonb)
    into rows_json
  from (
    select au.id,
      coalesce(nullif(btrim(up.display_name),''),nullif(btrim(concat_ws(' ',up.first_name,up.last_name)),''),au.email,au.id::text) as label,
      au.email,
      up.customer_number,
      case when sm.user_id is not null and sm.status='active' then 'staff' else 'customer' end as kind,
      case when sm.user_id is not null and sm.status='active' then sm.status else coalesce(up.status,'active') end as status
    from auth.users au
    left join public.user_profiles up on up.id=au.id
    left join public.staff_members sm on sm.user_id=au.id
    where (up.id is not null or (sm.user_id is not null and sm.status='active'))
      and (
        nullif(btrim(coalesce(p_query,'')),'') is null
        or lower(coalesce(up.display_name,'')) like '%'||lower(btrim(p_query))||'%'
        or lower(coalesce(up.first_name,'')) like '%'||lower(btrim(p_query))||'%'
        or lower(coalesce(up.last_name,'')) like '%'||lower(btrim(p_query))||'%'
        or lower(coalesce(au.email,'')) like '%'||lower(btrim(p_query))||'%'
        or lower(coalesce(up.customer_number,'')) like '%'||lower(btrim(p_query))||'%'
      )
    order by kind desc,label,email
    limit 120
  ) x;

  return jsonb_build_object('recipients',rows_json);
end $$;

revoke all on function public.notification_admin_recipient_options(text) from public,anon,authenticated;
grant execute on function public.notification_admin_recipient_options(text) to authenticated;

create or replace function public.notification_admin_send(
  p_audience text,
  p_recipient_user_ids uuid[] default null,
  p_kind text default 'notification',
  p_title text default '',
  p_message text default '',
  p_severity text default 'info',
  p_action_url text default null
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
begin
  if actor is null then raise exception 'authentication required'; end if;
  if not public.has_permission('notifications.send') then raise exception 'permission denied'; end if;
  if p_audience not in ('selected','customers','staff','everyone') then raise exception 'invalid audience'; end if;
  if p_kind not in ('notification','message','alert','announcement','maintenance') then raise exception 'invalid notification type'; end if;
  if p_severity not in ('info','success','warning','error') then raise exception 'invalid notification severity'; end if;
  if clean_title='' then raise exception 'title is required'; end if;
  if length(clean_title)>160 then raise exception 'title is too long'; end if;
  if length(clean_message)>4000 then raise exception 'message is too long'; end if;
  if clean_action is not null and (left(clean_action,1)<>'/' or left(clean_action,2)='//') then
    raise exception 'action path must be a local OrbitFS path';
  end if;
  if p_audience='selected' and coalesce(array_length(p_recipient_user_ids,1),0)=0 then
    raise exception 'select at least one recipient';
  end if;

  for r in
    select au.id as user_id,
      case when exists(
        select 1 from public.staff_members sm where sm.user_id=au.id and sm.status='active'
      ) then 'admin' else 'portal' end as surface
    from auth.users au
    where
      (p_audience='selected' and au.id=any(coalesce(p_recipient_user_ids,'{}'::uuid[])))
      or (p_audience='staff' and exists(select 1 from public.staff_members sm where sm.user_id=au.id and sm.status='active'))
      or (p_audience='customers' and exists(select 1 from public.user_profiles up where up.id=au.id) and not exists(select 1 from public.staff_members sm where sm.user_id=au.id and sm.status='active'))
      or (p_audience='everyone' and (exists(select 1 from public.user_profiles up where up.id=au.id) or exists(select 1 from public.staff_members sm where sm.user_id=au.id and sm.status='active')))
  loop
    perform public.notification_emit(
      r.user_id,
      r.surface,
      'admin_message',
      'admin.manual.'||p_kind,
      clean_title,
      clean_message,
      p_severity,
      actor,
      'admin_dispatch',
      dispatch_id::text,
      clean_action,
      jsonb_build_object('manual',true,'kind',p_kind,'dispatch_id',dispatch_id,'audience',p_audience),
      'admin-dispatch-'||dispatch_id::text||'-'||r.user_id::text
    );
    sent:=sent+1;
  end loop;

  select email into actor_email from auth.users where id=actor;
  insert into public.admin_audit_log(actor_id,actor_email,action,target_type,target_id,detail)
  values(
    actor,actor_email,'notification.send','notification_dispatch',dispatch_id::text,
    jsonb_build_object(
      'audience',p_audience,
      'kind',p_kind,
      'severity',p_severity,
      'title',clean_title,
      'action_url',clean_action,
      'sent',sent,
      'selected_count',coalesce(array_length(p_recipient_user_ids,1),0)
    )
  );

  return jsonb_build_object('ok',true,'dispatch_id',dispatch_id,'sent',sent);
end $$;

revoke all on function public.notification_admin_send(text,uuid[],text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.notification_admin_send(text,uuid[],text,text,text,text,text) to authenticated;
