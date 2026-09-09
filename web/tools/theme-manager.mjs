import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const root=process.cwd();
const themesDir=path.join(root,"src","themes");
const [command,arg1,arg2]=process.argv.slice(2);

async function readManifest(dir){const raw=await fs.readFile(path.join(dir,"manifest.json"),"utf8");const m=JSON.parse(raw);if(!m.id||!m.surface||!m.entry)throw new Error("Theme manifest requires id, surface and entry");if(!["admin","customer"].includes(m.surface))throw new Error("Theme surface must be admin or customer");return m;}
async function walk(dir,base=dir){const out=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await walk(p,base));else out.push({full:p,rel:path.relative(base,p)});}return out;}
async function applyTheme(id){const dir=path.join(themesDir,id);const m=await readManifest(dir);await fs.access(path.join(dir,m.entry));const target=path.join(themesDir,"active",m.surface==="admin"?"admin.css":"customer.css");await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,`/* Active OrbitFS ${m.surface} theme. Managed by tools/theme-manager.mjs */\n@import "../${m.id}/${m.entry}";\n`);console.log(`Applied ${m.id} to ${m.surface}.`);}
async function packTheme(id,outArg){const dir=path.join(themesDir,id);const m=await readManifest(dir);const zip=new JSZip();for(const f of await walk(dir)){zip.file(`${m.id}/${f.rel.replaceAll(path.sep,"/")}`,await fs.readFile(f.full));}const out=path.resolve(outArg||path.join(root,"theme-packages",`${m.id}-${m.version||"1.0.0"}.orbit-theme.zip`));await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE"}));console.log(out);}
async function installTheme(zipPath,apply=false){const zip=await JSZip.loadAsync(await fs.readFile(path.resolve(zipPath)));const manifests=Object.keys(zip.files).filter(n=>n.endsWith("/manifest.json"));if(manifests.length!==1)throw new Error("Theme package must contain exactly one manifest.json");const prefix=manifests[0].slice(0,-"manifest.json".length);const manifest=JSON.parse(await zip.file(manifests[0]).async("string"));if(!manifest.id||!manifest.surface||!manifest.entry)throw new Error("Invalid theme manifest");if(prefix!==`${manifest.id}/`)throw new Error("Package root must match manifest id");const dest=path.join(themesDir,manifest.id);await fs.rm(dest,{recursive:true,force:true});await fs.mkdir(dest,{recursive:true});for(const [name,entry] of Object.entries(zip.files)){if(entry.dir||!name.startsWith(prefix))continue;const rel=name.slice(prefix.length);const full=path.join(dest,rel);if(!full.startsWith(dest))throw new Error("Unsafe theme path");await fs.mkdir(path.dirname(full),{recursive:true});await fs.writeFile(full,await entry.async("nodebuffer"));}await readManifest(dest);if(apply)await applyTheme(manifest.id);console.log(`Installed ${manifest.id}.`);}

try{
 if(command==="pack")await packTheme(arg1,arg2);
 else if(command==="install")await installTheme(arg1,false);
 else if(command==="install-apply")await installTheme(arg1,true);
 else if(command==="apply")await applyTheme(arg1);
 else throw new Error("Usage: node tools/theme-manager.mjs pack <ThemeId> [output] | install <zip> | install-apply <zip> | apply <ThemeId>");
}catch(error){console.error(error.message||error);process.exit(1);}
