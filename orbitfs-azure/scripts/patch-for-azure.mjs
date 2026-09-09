import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const apps = [
  path.join(root, 'orbitfs-azure', 'source', 'base'),
  path.join(root, 'orbitfs-azure', 'source', 'engine')
];

for (const app of apps) {
  const vite = path.join(app, 'vite.config.ts');
  const text = await fs.readFile(vite, 'utf8');
  const patched = text
    .replace(/@sveltejs\/adapter-vercel/g, '@sveltejs/adapter-node')
    .replace(/adapter\(\)/g, 'adapter()');
  if (!patched.includes("@sveltejs/adapter-node")) {
    throw new Error(`Could not convert ${vite} to adapter-node.`);
  }
  await fs.writeFile(vite, patched);
}

console.log('Converted OrbitFS Base and Engine from the Vercel adapter to the Node adapter for Azure App Service.');
