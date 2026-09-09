-- Support department staffing safeguards.
-- Applied to Supabase project zekejuprrsurjmwgzexw on 2026-09-03.
-- Department membership is for Support + Senior Support; Admin/Superadmin manage all queues.

create or replace function public.admin_support_settings_snapshot() returns jsonb
language plpgsql security definer set search_path='public','auth' as $$
declare deps jsonb; people jsonb; templates jsonb;
begin
 if not (public.has_permission('support.settings') or public.has_permission('support.departments.manage')) then raise exception 'permission denied: support.departments.manage'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'slug',d.slug,'description',d.description,'email',d.email,'enabled',d.enabled,'client_can_close',d.client_can_close,'auto_close_hours',d.auto_close_hours,'sort_order',d.sort_order,'member_ids',coalesce((select jsonb_agg(ds.user_id order by ds.created_at) from public.support_department_staff ds where ds.department_id=d.id),'[]'::jsonb)) order by d.sort_order,d.name),'[]'::jsonb) into deps from public.support_departments d;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',sm.user_id,'display_name',coalesce(up.display_name,trim(concat_ws(' ',up.first_name,up.last_name)),au.email,sm.user_id::text),'email',au.email,'title',sm.title,'status',sm.status,'rank',public.support_staff_rank(sm.user_id),'rank_label',public.support_staff_rank_label(public.support_staff_rank(sm.user_id))) order by public.support_staff_rank(sm.user_id) desc,coalesce(up.display_name,au.email)),'[]'::jsonb) into people from public.staff_members sm left join public.user_profiles up on up.id=sm.user_id left join auth.users au on au.id=sm.user_id where sm.status='active' and public.support_staff_rank(sm.user_id) in (1,2);
 select coalesce(jsonb_agg(to_jsonb(t) order by t.label),'[]'::jsonb) into templates from public.support_message_templates t;
 return jsonb_build_object('departments',deps,'staff',people,'templates',templates,'hierarchy',jsonb_build_array(jsonb_build_object('rank',1,'slug','support','label','Support','description','Worker'),jsonb_build_object('rank',2,'slug','senior-support','label','Senior Support','description','Supervisor'),jsonb_build_object('rank',3,'slug','admin','label','Admin','description','Manager'),jsonb_build_object('rank',4,'slug','superadmin','label','Superadmin','description','Boss / final escalation')));
end $$;

create or replace function public.admin_set_support_department_members(p_department_id uuid,p_user_ids uuid[]) returns jsonb language plpgsql security definer set search_path='public' as $$
declare uid uuid; count_added integer:=0; r integer;
begin
 if not (public.has_permission('support.settings') or public.has_permission('support.departments.manage')) then raise exception 'permission denied: support.departments.manage'; end if;
 if not exists(select 1 from public.support_departments where id=p_department_id) then raise exception 'department not found'; end if;
 delete from public.support_department_staff where department_id=p_department_id;
 foreach uid in array coalesce(p_user_ids,'{}'::uuid[]) loop
   r:=public.support_staff_rank(uid);
   if r not in (1,2) then raise exception 'department membership is only for Support and Senior Support staff'; end if;
   insert into public.support_department_staff(department_id,user_id,created_by) values(p_department_id,uid,auth.uid()) on conflict do nothing;
   count_added:=count_added+1;
 end loop;
 insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail) values(auth.uid(),'support.department.members','support_department',p_department_id::text,jsonb_build_object('member_count',count_added,'user_ids',to_jsonb(coalesce(p_user_ids,'{}'::uuid[]))));
 return jsonb_build_object('ok',true,'member_count',count_added);
end $$;

create or replace function public.admin_delete_support_department(p_department_id uuid) returns jsonb language plpgsql security definer set search_path='public' as $$
declare ticket_count integer; dname text;
begin
 if not (public.has_permission('support.settings') or public.has_permission('support.departments.manage')) then raise exception 'permission denied: support.departments.manage'; end if;
 select name into dname from public.support_departments where id=p_department_id; if dname is null then raise exception 'department not found'; end if;
 select count(*) into ticket_count from public.support_tickets where department_id=p_department_id;
 if ticket_count>0 then raise exception 'department has % historical or active ticket(s); disable it instead to preserve ticket history',ticket_count; end if;
 delete from public.support_departments where id=p_department_id;
 insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail) values(auth.uid(),'support.department.delete','support_department',p_department_id::text,jsonb_build_object('name',dname));
 return jsonb_build_object('ok',true);
end $$;
