-- OrbitFS central notification centre v1
-- One backend stream, surfaced separately in Admin and Customer Portal.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  surface text not null check (surface in ('admin','portal')),
  category text not null default 'general',
  event_type text not null,
  title text not null,
  message text not null default '',
  severity text not null default 'info' check (severity in ('info','success','warning','error')),
  actor_user_id uuid references auth.users(id) on delete set null,
  source_type text,
  source_id text,
  action_url text,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text,
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_surface_created_idx
  on public.notifications(recipient_user_id,surface,created_at desc);
create index if not exists notifications_recipient_unread_idx
  on public.notifications(recipient_user_id,surface,created_at desc)
  where read_at is null and archived_at is null;
create unique index if not exists notifications_dedupe_idx
  on public.notifications(recipient_user_id,surface,dedupe_key)
  where dedupe_key is not null;

alter table public.notifications enable row level security;
drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications
  for select to authenticated
  using (recipient_user_id=auth.uid());

revoke insert, update, delete on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

create or replace function public.notification_emit(
  p_recipient_user_id uuid,
  p_surface text,
  p_category text,
  p_event_type text,
  p_title text,
  p_message text default '',
  p_severity text default 'info',
  p_actor_user_id uuid default null,
  p_source_type text default null,
  p_source_id text default null,
  p_action_url text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key text default null
) returns uuid
language plpgsql security definer set search_path='public','auth' as $$
declare nid uuid;
begin
  if p_recipient_user_id is null or not exists(select 1 from auth.users where id=p_recipient_user_id) then return null; end if;
  if p_surface not in ('admin','portal') then raise exception 'invalid notification surface'; end if;
  if p_severity not in ('info','success','warning','error') then raise exception 'invalid notification severity'; end if;
  if nullif(btrim(coalesce(p_title,'')),'') is null then raise exception 'notification title is required'; end if;

  insert into public.notifications(
    recipient_user_id,surface,category,event_type,title,message,severity,actor_user_id,
    source_type,source_id,action_url,metadata,dedupe_key
  ) values(
    p_recipient_user_id,p_surface,coalesce(nullif(btrim(p_category),''),'general'),p_event_type,
    btrim(p_title),coalesce(p_message,''),p_severity,p_actor_user_id,
    p_source_type,p_source_id,p_action_url,coalesce(p_metadata,'{}'::jsonb),p_dedupe_key
  )
  on conflict (recipient_user_id,surface,dedupe_key) where dedupe_key is not null
  do update set
    category=excluded.category,
    event_type=excluded.event_type,
    title=excluded.title,
    message=excluded.message,
    severity=excluded.severity,
    actor_user_id=excluded.actor_user_id,
    source_type=excluded.source_type,
    source_id=excluded.source_id,
    action_url=excluded.action_url,
    metadata=excluded.metadata,
    read_at=null,
    archived_at=null,
    created_at=now()
  returning id into nid;
  return nid;
end $$;

revoke all on function public.notification_emit(uuid,text,text,text,text,text,text,uuid,text,text,text,jsonb,text) from public, anon, authenticated;

create or replace function public.notification_feed(p_surface text, p_limit integer default 40) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare uid uuid:=auth.uid(); rows_json jsonb; unread_count integer; safe_limit integer;
begin
  if uid is null then raise exception 'authentication required'; end if;
  if p_surface not in ('admin','portal') then raise exception 'invalid notification surface'; end if;
  safe_limit:=greatest(1,least(coalesce(p_limit,40),100));

  select count(*)::integer into unread_count
  from public.notifications
  where recipient_user_id=uid and surface=p_surface and read_at is null and archived_at is null;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into rows_json
  from (
    select id,category,event_type,title,message,severity,actor_user_id,source_type,source_id,
      action_url,metadata,read_at,created_at
    from public.notifications
    where recipient_user_id=uid and surface=p_surface and archived_at is null
    order by created_at desc
    limit safe_limit
  ) x;

  return jsonb_build_object('notifications',rows_json,'unread_count',unread_count);
end $$;

grant execute on function public.notification_feed(text,integer) to authenticated;

create or replace function public.notification_mark_read(p_notification_id uuid, p_read boolean default true) returns jsonb
language plpgsql security definer set search_path='public' as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  update public.notifications
  set read_at=case when coalesce(p_read,true) then coalesce(read_at,now()) else null end
  where id=p_notification_id and recipient_user_id=auth.uid();
  if not found then raise exception 'notification not found'; end if;
  return jsonb_build_object('ok',true,'read',coalesce(p_read,true));
end $$;

grant execute on function public.notification_mark_read(uuid,boolean) to authenticated;

create or replace function public.notification_mark_all_read(p_surface text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare changed integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_surface not in ('admin','portal') then raise exception 'invalid notification surface'; end if;
  update public.notifications set read_at=coalesce(read_at,now())
  where recipient_user_id=auth.uid() and surface=p_surface and read_at is null and archived_at is null;
  get diagnostics changed=row_count;
  return jsonb_build_object('ok',true,'changed',changed);
end $$;

grant execute on function public.notification_mark_all_read(text) to authenticated;

create or replace function public.notification_notify_support_department(
  p_department_id uuid,
  p_actor_user_id uuid,
  p_event_type text,
  p_title text,
  p_message text,
  p_severity text,
  p_ticket_id uuid,
  p_metadata jsonb default '{}'::jsonb,
  p_exact_rank integer default null,
  p_exclude_user_id uuid default null
) returns integer
language plpgsql security definer set search_path='public' as $$
declare r record; sent integer:=0; member_count integer:=0;
begin
  for r in
    select distinct sm.user_id
    from public.staff_members sm
    where sm.status='active'
      and sm.user_id is distinct from p_actor_user_id
      and sm.user_id is distinct from p_exclude_user_id
      and public.support_staff_rank(sm.user_id)>0
      and (
        (p_exact_rank is not null and public.support_staff_rank(sm.user_id)=p_exact_rank and public.support_user_has_department(sm.user_id,p_department_id))
        or
        (p_exact_rank is null and exists(select 1 from public.support_department_staff ds where ds.department_id=p_department_id and ds.user_id=sm.user_id))
      )
  loop
    perform public.notification_emit(
      r.user_id,'admin','support',p_event_type,p_title,p_message,p_severity,p_actor_user_id,
      'support_ticket',p_ticket_id::text,'/admin/support/'||p_ticket_id::text,
      coalesce(p_metadata,'{}'::jsonb),null
    );
    sent:=sent+1;
  end loop;

  member_count:=sent;
  if member_count=0 and p_exact_rank is null then
    for r in
      select sm.user_id from public.staff_members sm
      where sm.status='active'
        and public.support_staff_rank(sm.user_id)>=3
        and sm.user_id is distinct from p_actor_user_id
        and sm.user_id is distinct from p_exclude_user_id
    loop
      perform public.notification_emit(
        r.user_id,'admin','support',p_event_type,p_title,p_message,p_severity,p_actor_user_id,
        'support_ticket',p_ticket_id::text,'/admin/support/'||p_ticket_id::text,
        coalesce(p_metadata,'{}'::jsonb),null
      );
      sent:=sent+1;
    end loop;
  end if;
  return sent;
end $$;

revoke all on function public.notification_notify_support_department(uuid,uuid,text,text,text,text,uuid,jsonb,integer,uuid) from public, anon, authenticated;

create or replace function public.notify_support_ticket_created() returns trigger
language plpgsql security definer set search_path='public' as $$
declare actor uuid:=auth.uid(); dept_name text;
begin
  select name into dept_name from public.support_departments where id=new.department_id;

  perform public.notification_notify_support_department(
    new.department_id,actor,'support.ticket.created',
    'New support ticket #'||new.ticket_number::text,
    new.subject||' · '||coalesce(dept_name,'Support'),
    case when new.priority in ('high','urgent') then 'warning' else 'info' end,
    new.id,
    jsonb_build_object('ticket_number',new.ticket_number,'priority',new.priority,'department_id',new.department_id),
    null,null
  );

  if new.source='admin' and new.user_id is distinct from actor then
    perform public.notification_emit(
      new.user_id,'portal','support','support.ticket.opened',
      'Support ticket #'||new.ticket_number::text||' opened',
      new.subject,'info',actor,'support_ticket',new.id::text,
      '/portal/support/'||new.id::text,
      jsonb_build_object('ticket_number',new.ticket_number,'priority',new.priority),
      'support-opened-'||new.id::text
    );
  end if;
  return new;
end $$;

drop trigger if exists notify_support_ticket_created_trg on public.support_tickets;
create trigger notify_support_ticket_created_trg
after insert on public.support_tickets
for each row execute function public.notify_support_ticket_created();

create or replace function public.notify_support_ticket_updated() returns trigger
language plpgsql security definer set search_path='public' as $$
declare actor uuid:=auth.uid(); dept_name text; old_dept_name text; target_rank integer;
begin
  if old.assigned_to is distinct from new.assigned_to then
    if new.assigned_to is not null and new.assigned_to is distinct from actor then
      perform public.notification_emit(
        new.assigned_to,'admin','support','support.ticket.assigned',
        'Ticket #'||new.ticket_number::text||' assigned to you',
        new.subject,'info',actor,'support_ticket',new.id::text,
        '/admin/support/'||new.id::text,
        jsonb_build_object('ticket_number',new.ticket_number,'priority',new.priority,'department_id',new.department_id),
        null
      );
    end if;

    if old.assigned_to is not null and old.assigned_to is distinct from new.assigned_to and old.assigned_to is distinct from actor then
      perform public.notification_emit(
        old.assigned_to,'admin','support','support.ticket.assignment_removed',
        'Ticket #'||new.ticket_number::text||' is no longer assigned to you',
        new.subject,'info',actor,'support_ticket',new.id::text,
        '/admin/support/'||new.id::text,
        jsonb_build_object('ticket_number',new.ticket_number,'new_assigned_to',new.assigned_to),
        null
      );
    end if;
  end if;

  if old.escalation_level is distinct from new.escalation_level then
    if new.escalation_level>0 and new.assigned_to is null then
      target_rank:=new.escalation_level+1;
      perform public.notification_notify_support_department(
        new.department_id,actor,'support.ticket.escalated',
        'Escalated ticket #'||new.ticket_number::text||' needs to be claimed',
        new.subject,
        'warning',new.id,
        jsonb_build_object('ticket_number',new.ticket_number,'escalation_level',new.escalation_level,'claim_required',new.claim_required),
        target_rank,new.assigned_to
      );
    end if;
  elsif old.department_id is distinct from new.department_id then
    select name into dept_name from public.support_departments where id=new.department_id;
    select name into old_dept_name from public.support_departments where id=old.department_id;
    perform public.notification_notify_support_department(
      new.department_id,actor,'support.ticket.department_transferred',
      'Ticket #'||new.ticket_number::text||' transferred to '||coalesce(dept_name,'your department'),
      case when new.claim_required then 'This ticket must be claimed before work continues.' else new.subject end,
      'warning',new.id,
      jsonb_build_object('ticket_number',new.ticket_number,'from_department',old_dept_name,'to_department',dept_name,'claim_required',new.claim_required),
      null,new.assigned_to
    );
  end if;

  if old.status is distinct from new.status then
    if actor is distinct from new.user_id and new.status not in ('customer_reply','staff_reply') then
      perform public.notification_emit(
        new.user_id,'portal','support','support.ticket.status_changed',
        'Ticket #'||new.ticket_number::text||' status changed',
        'Status: '||initcap(replace(new.status,'_',' ')),'info',actor,
        'support_ticket',new.id::text,'/portal/support/'||new.id::text,
        jsonb_build_object('ticket_number',new.ticket_number,'from_status',old.status,'status',new.status),
        null
      );
    elsif actor=new.user_id and new.status='closed' and old.status<>'closed' and new.assigned_to is not null and new.assigned_to is distinct from actor then
      perform public.notification_emit(
        new.assigned_to,'admin','support','support.ticket.customer_closed',
        'Customer closed ticket #'||new.ticket_number::text,
        new.subject,'info',actor,'support_ticket',new.id::text,
        '/admin/support/'||new.id::text,jsonb_build_object('ticket_number',new.ticket_number),null
      );
    end if;
  end if;

  if old.priority is distinct from new.priority and new.assigned_to is not null and new.assigned_to is distinct from actor then
    perform public.notification_emit(
      new.assigned_to,'admin','support','support.ticket.priority_changed',
      'Priority changed on ticket #'||new.ticket_number::text,
      'Priority: '||initcap(new.priority),'warning',actor,'support_ticket',new.id::text,
      '/admin/support/'||new.id::text,jsonb_build_object('ticket_number',new.ticket_number,'from_priority',old.priority,'priority',new.priority),null
    );
  end if;

  return new;
end $$;

drop trigger if exists notify_support_ticket_updated_trg on public.support_tickets;
create trigger notify_support_ticket_updated_trg
after update on public.support_tickets
for each row execute function public.notify_support_ticket_updated();

create or replace function public.notify_support_message_created() returns trigger
language plpgsql security definer set search_path='public' as $$
declare t public.support_tickets%rowtype; actor uuid:=new.author_user_id; human_count integer; preview text;
begin
  select * into t from public.support_tickets where id=new.ticket_id;
  if not found then return new; end if;

  select count(*)::integer into human_count
  from public.support_ticket_messages
  where ticket_id=new.ticket_id and author_role<>'system';
  if human_count<=1 then return new; end if;

  preview:=left(regexp_replace(coalesce(new.body,''),'\s+',' ','g'),180);

  if new.internal_note then
    if t.assigned_to is not null and t.assigned_to is distinct from actor then
      perform public.notification_emit(
        t.assigned_to,'admin','support','support.ticket.internal_note',
        'Internal note on ticket #'||t.ticket_number::text,
        preview,'info',actor,'support_ticket',t.id::text,'/admin/support/'||t.id::text,
        jsonb_build_object('ticket_number',t.ticket_number,'message_id',new.id),null
      );
    end if;
    return new;
  end if;

  if new.author_role='user' then
    if t.assigned_to is not null and t.assigned_to is distinct from actor then
      perform public.notification_emit(
        t.assigned_to,'admin','support','support.ticket.customer_reply',
        'Customer replied to ticket #'||t.ticket_number::text,
        preview,'info',actor,'support_ticket',t.id::text,'/admin/support/'||t.id::text,
        jsonb_build_object('ticket_number',t.ticket_number,'message_id',new.id),null
      );
    else
      perform public.notification_notify_support_department(
        t.department_id,actor,'support.ticket.customer_reply',
        'Customer replied to ticket #'||t.ticket_number::text,
        preview,'info',t.id,
        jsonb_build_object('ticket_number',t.ticket_number,'message_id',new.id),
        case when t.escalation_level>0 then t.escalation_level+1 else null end,
        null
      );
    end if;
  elsif new.author_role<>'system' and t.user_id is distinct from actor then
    perform public.notification_emit(
      t.user_id,'portal','support','support.ticket.staff_reply',
      'New reply on ticket #'||t.ticket_number::text,
      preview,'info',actor,'support_ticket',t.id::text,'/portal/support/'||t.id::text,
      jsonb_build_object('ticket_number',t.ticket_number,'message_id',new.id),null
    );
  end if;
  return new;
end $$;

drop trigger if exists notify_support_message_created_trg on public.support_ticket_messages;
create trigger notify_support_message_created_trg
after insert on public.support_ticket_messages
for each row execute function public.notify_support_message_created();

alter table public.notifications replica identity full;
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;
