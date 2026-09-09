-- Keep the support hierarchy terminology exactly: Support -> Senior Support -> Admin -> Superadmin.
-- Applied to Supabase project zekejuprrsurjmwgzexw on 2026-09-03.
create or replace function public.support_staff_rank_label(p_rank integer) returns text
language sql immutable as $$
  select case p_rank
    when 4 then 'Superadmin'
    when 3 then 'Admin'
    when 2 then 'Senior Support'
    when 1 then 'Support'
    else 'No support role'
  end
$$;
