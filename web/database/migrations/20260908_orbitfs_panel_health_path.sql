update public.orbitfs_release_system_settings
set health_path='/api/health', updated_at=now()
where id='primary' and health_path='/';
