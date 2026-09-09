-- Staff department assignment + support handoff claim rules.
-- Staff can belong to multiple support departments. Senior Support+ may claim department handoffs.

create or replace function public.admin_set_staff_departments(p_user_id uuid,p_department_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare ids uuid[]:=coalesce(p_department_ids,'{}'::uuid[]);
begin
  if not (public.has_permission('staff.manage') or public.has_permission('staff.invite') or public.has_permission('settings.permissions')) then
    raise exception 'permission denied: staff department management';
  end if;
  if not exists(select 1 from public.staff_members where user_id=p_user_id) then raise exception 'staff member not found'; end if;
  if exists(select 1 from unnest(ids) d left join public.support_departments sd on sd.id=d and sd.enabled=true where sd.id is null) then
    raise exception 'one or more support departments are invalid';
  end if;
  delete from public.support_department_staff where user_id=p_user_id;
  insert into public.support_department_staff(department_id,user_id,created_by)
  select distinct d,p_user_id,auth.uid() from unnest(ids) d;
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(auth.uid(),'staff.departments_updated','staff_member',p_user_id::text,jsonb_build_object('department_ids',ids));
  return jsonb_build_object('ok',true,'department_ids',to_jsonb(ids));
end
$function$;

create or replace function public.support_staff_can_access_ticket(p_ticket_id uuid, p_user_id uuid default auth.uid())
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare r integer; t public.support_tickets%rowtype; min_rank integer;
begin
 if p_user_id is null then return false; end if;
 r:=public.support_staff_rank(p_user_id); if r<=0 then return false; end if;
 select * into t from public.support_tickets where id=p_ticket_id; if not found then return false; end if;
 select min_support_rank into min_rank from public.support_departments where id=t.department_id;
 if r<coalesce(min_rank,1) then return false; end if;
 if r>=3 then return true; end if;
 if t.escalation_level>greatest(r-1,0) then return false; end if;
 if t.claim_required and r>=2 then return true; end if;
 return t.assigned_to=p_user_id or public.support_user_has_department(p_user_id,t.department_id);
end
$function$;
