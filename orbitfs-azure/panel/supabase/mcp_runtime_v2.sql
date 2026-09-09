-- OrbitFS MCP v2 bounded file access helpers.
-- Keep filtering/listing in Supabase so MCP does not download thousands of rows into Vercel.

create or replace function public.orbitfs_mcp_search_files(
  p_workspace_id text,
  p_query text,
  p_base_path text default '',
  p_include_content boolean default false,
  p_limit integer default 50
)
returns table(
  id uuid,
  name text,
  path text,
  kind text,
  mime_type text,
  size_bytes bigint,
  updated_at timestamptz,
  score integer,
  excerpt text
)
language sql
stable
security invoker
set search_path = public
as $$
  with matched as (
    select
      f.id,
      f.name,
      f.path,
      f.kind,
      f.mime_type,
      f.size_bytes,
      f.updated_at,
      ((case when position(lower(p_query) in lower(coalesce(f.name,''))) > 0 then 5 else 0 end)
       + (case when position(lower(p_query) in lower(coalesce(f.path,''))) > 0 then 3 else 0 end)
       + (case when p_include_content and position(lower(p_query) in lower(coalesce(f.content_text,''))) > 0 then 2 else 0 end))::integer as score,
      case
        when p_include_content and position(lower(p_query) in lower(coalesce(f.content_text,''))) > 0 then
          substring(
            coalesce(f.content_text,'')
            from greatest(1, position(lower(p_query) in lower(coalesce(f.content_text,''))) - 120)
            for 420
          )
        else ''
      end as excerpt
    from public.orbitfs_files f
    where f.workspace_id = p_workspace_id::uuid
      and f.deleted_at is null
      and (
        coalesce(p_base_path,'') = ''
        or f.path = p_base_path
        or f.path like (rtrim(p_base_path,'/') || '/%')
      )
      and (
        position(lower(p_query) in lower(coalesce(f.name,''))) > 0
        or position(lower(p_query) in lower(coalesce(f.path,''))) > 0
        or (p_include_content and position(lower(p_query) in lower(coalesce(f.content_text,''))) > 0)
      )
  )
  select id,name,path,kind,mime_type,size_bytes,updated_at,score,excerpt
  from matched
  order by score desc, path asc
  limit greatest(1,least(coalesce(p_limit,50),250));
$$;

revoke all on function public.orbitfs_mcp_search_files(text,text,text,boolean,integer) from public;
grant execute on function public.orbitfs_mcp_search_files(text,text,text,boolean,integer) to service_role;

create or replace function public.orbitfs_mcp_folder_files(
  p_workspace_id text,
  p_base_path text default '',
  p_recursive boolean default true,
  p_max_files integer default 100,
  p_max_depth integer default 10
)
returns table(path text)
language sql
stable
security invoker
set search_path = public
as $$
  with candidates as (
    select
      f.path,
      case
        when coalesce(p_base_path,'') = '' then f.path
        else substring(f.path from length(rtrim(p_base_path,'/')) + 2)
      end as relative_path
    from public.orbitfs_files f
    where f.workspace_id = p_workspace_id::uuid
      and f.deleted_at is null
      and f.kind = 'file'
      and f.path not like '_trash/%'
      and (
        coalesce(p_base_path,'') = ''
        or f.path like (rtrim(p_base_path,'/') || '/%')
      )
  )
  select c.path
  from candidates c
  where
    case
      when p_recursive then greatest(0,array_length(regexp_split_to_array(c.relative_path,'/'),1)-1) <= greatest(0,least(coalesce(p_max_depth,10),50))
      else greatest(0,array_length(regexp_split_to_array(c.relative_path,'/'),1)-1) = 0
    end
  order by c.path
  limit greatest(1,least(coalesce(p_max_files,100),1000));
$$;

revoke all on function public.orbitfs_mcp_folder_files(text,text,boolean,integer,integer) from public;
grant execute on function public.orbitfs_mcp_folder_files(text,text,boolean,integer,integer) to service_role;
