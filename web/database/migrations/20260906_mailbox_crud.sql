-- OrbitFS Mail mailbox CRUD for the split Mail Config panel.
-- Mailbox authority remains staff-group permission based.

create or replace function public.mail_admin_create_account(
  p_address text,
  p_display_name text,
  p_kind text default 'shared'
)
returns boolean
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_address text:=lower(trim(coalesce(p_address,'')));
  v_display_name text:=trim(coalesce(p_display_name,''));
  v_kind text:=trim(coalesce(p_kind,'shared'));
begin
  if not public.is_staff() or not public.has_permission('mail.settings') then
    raise exception 'Mail settings permission required';
  end if;
  if v_address='' or v_address !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid mailbox address is required';
  end if;
  if v_display_name='' then v_display_name:=split_part(v_address,'@',1); end if;
  if v_kind='' then v_kind:='shared'; end if;

  insert into public.mail_accounts(address,display_name,kind,active)
  values(v_address,v_display_name,v_kind,true);
  return true;
exception
  when unique_violation then raise exception 'Mailbox already exists';
end
$$;

create or replace function public.mail_admin_delete_account(p_address text)
returns boolean
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_address text:=lower(trim(coalesce(p_address,'')));
begin
  if not public.is_staff() or not public.has_permission('mail.settings') then
    raise exception 'Mail settings permission required';
  end if;
  if v_address='' then raise exception 'Mailbox address is required'; end if;

  delete from public.mail_accounts where lower(address)=v_address;
  if not found then raise exception 'Mailbox not found'; end if;
  return true;
end
$$;
