import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const repos = [
  { name: 'base', path: path.join(root, 'orbitfs-azure', 'source', 'base'), repo: 'lucaskerim123/V1-vercel-base', ref: 'MASTER_EDIT_SYSTEM' },
  { name: 'engine', path: path.join(root, 'orbitfs-azure', 'source', 'engine'), repo: 'lucaskerim123/V1-vercel-engine', ref: 'main' }
];

const token = process.env.ORBITFS_SOURCE_TOKEN;
if (!token) throw new Error('ORBITFS_SOURCE_TOKEN is required to read the private OrbitFS core repositories.');

async function github(pathname) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28'
    }
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function downloadTree(repo, ref, dest) {
  const tree = await github(`/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  if (tree.truncated) throw new Error(`Git tree for ${repo}@${ref} was truncated; refusing an incomplete Azure build.`);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  for (const entry of tree.tree) {
    if (entry.type !== 'blob') continue;
    const target = path.join(dest, entry.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const blob = await github(`/repos/${repo}/git/blobs/${entry.sha}`);
    const data = Buffer.from(blob.content.replace(/\n/g, ''), 'base64');
    await fs.writeFile(target, data);
  }
}

for (const item of repos) {
  console.log(`Syncing ${item.repo}@${item.ref} -> ${item.path}`);
  await downloadTree(item.repo, item.ref, item.path);
}

console.log('OrbitFS Base + Engine source sync complete.');
