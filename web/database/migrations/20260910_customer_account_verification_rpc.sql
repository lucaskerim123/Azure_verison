create or replace function public.get_my_customer_account()
returns jsonb language sql stable security definer set search_path='public'
as $$
  select coalesce((select jsonb_build_object('id',c.id,'auth_user_id',c.auth_user_id,'email',c.email,'email_verified_at',c.email_verified_at,'status',c.status,'role',coalesce(up.role,'user')) from public.customers c left join public.user_profiles up on up.id=c.auth_user_id where c.auth_user_id=auth.uid() limit 1),'{}'::jsonb);
$$;
grant execute on function public.get_my_customer_account() to authenticated;
