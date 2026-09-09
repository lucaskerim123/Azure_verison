const { spawnSync } = require('node:child_process');
const target = 'C:\\Users\\luke\\Desktop\\vercel\\Orbitconvert-mcp-addon';
const names = [
  'SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY',
  'ORBITFS_LICENSE_API_URL','ORBITFS_LICENSE_URL','ORBITFS_LICENSE_VALIDATE_URL',
  'ORBITFS_LICENSE_VALIDATE_PATH','ORBITFS_ENTITLEMENT_PUBLIC_KEY',
  'ORBITFS_LICENSE_TIMEOUT_MS','ORBITFS_LICENSE_REFRESH_MINUTES','ORBITFS_LICENSE_SIGNAL_MINUTES'
];
for (const name of names) {
  const value = process.env[name];
  if (!value) continue;
  const result = spawnSync('cmd.exe', ['/d','/s','/c',`npx vercel env add ${name} production --value "${String(value).replace(/"/g,'\\"')}" --yes --force`], {
    cwd: target, encoding: 'utf8', stdio: ['ignore','pipe','pipe']
  });
  if (result.status !== 0 && !String(result.stderr).includes('already exists')) {
    console.error(name + ': failed'); process.exitCode = 1;
  } else console.log(name + ': configured');
}
