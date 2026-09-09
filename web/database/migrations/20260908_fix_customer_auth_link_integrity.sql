-- Remove stale identity rows left behind after an auth user is deleted.
delete from public.customer_credentials cc
where not exists (select 1 from auth.users u where u.id = cc.user_id);

delete from public.email_verification_tokens t
where not exists (select 1 from auth.users u where u.id = t.user_id);

delete from public.password_reset_tokens t
where not exists (select 1 from auth.users u where u.id = t.user_id);

-- Keep customer auth links valid.
update public.customers c
set auth_user_id = null
where c.auth_user_id is not null
  and not exists (select 1 from auth.users u where u.id = c.auth_user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname = 'customers_auth_user_id_fkey'
  ) then
    alter table public.customers
      add constraint customers_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users(id) on delete set null;
  end if;
end
$$;
