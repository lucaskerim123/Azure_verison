"use client";

import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";
import styles from "./theme-manager.module.css";

type Theme={id:string;name:string;surface:"admin"|"customer";version:string;description:string;is_builtin:boolean;manifest:any;css_text?:string|null};

export default function ThemeManagerPage(){
 const [sb]=useState(()=>createClient());const [themes,setThemes]=useState<Theme[]>([]);const [activeAdmin,setActiveAdmin]=useState("V3A");const [activeCustomer,setActiveCustomer]=useState("V3C");const [status,setStatus]=useState("");const [manifestText,setManifestText]=useState("");const [cssText,setCssText]=useState("");
 async function load(){const {data,error}=await sb.rpc("orbitfs_theme_list");if(error){setStatus(error.message);return}setThemes(data?.themes||[]);setActiveAdmin(data?.active_admin||"V3A");setActiveCustomer(data?.active_customer||"V3C")}
 useEffect(()=>{void load()},[]);
 async function apply(id:string){setStatus(`Applying ${id}…`);const {error}=await sb.rpc("orbitfs_theme_apply",{p_theme_id:id});if(error){setStatus(error.message);return}setStatus(`${id} applied. Reload the relevant surface to see it.`);await load()}
 async function importTheme(){try{const manifest=JSON.parse(manifestText);setStatus("Importing theme…");const {data,error}=await sb.rpc("orbitfs_theme_import",{p_manifest:manifest,p_css:cssText});if(error){setStatus(error.message);return}setStatus(`${data.theme_id} imported for ${data.surface}.`);setManifestText("");setCssText("");await load()}catch{setStatus("Manifest must be valid JSON.")}}
 return <main className={styles.shell}>
  <header className={styles.head}><div><p className="eyebrow">SYSTEM · THEMES</p><h1>OrbitFS Theme Manager</h1><p className="muted">Installed themes are separated by surface. Admin themes cannot be applied to the Customer Portal and vice versa.</p></div></header>
  <section className={styles.grid}>{themes.map(t=>{const active=t.surface==="admin"?activeAdmin===t.id:activeCustomer===t.id;return <article key={t.id} className={`${styles.card} ${active?styles.active:""}`}>
   <div className={styles.cardTop}><div><h2>{t.name}</h2><p>{t.description}</p></div><span className={styles.badge}>{active?"ACTIVE":"INSTALLED"}</span></div>
   <div className={styles.meta}><span>{t.id}</span><span>{t.surface==="admin"?"Admin Panel":"Customer Portal"}</span><span>v{t.version}</span><span>{t.is_builtin?"Built-in":"Imported"}</span></div>
   <div className={styles.actions}><button type="button" onClick={()=>void apply(t.id)} disabled={active}>{active?"Applied":"Apply theme"}</button></div>
  </article>})}</section>
  <section className={styles.import}><div><h2>Import completed theme</h2><p className="muted">Paste the package manifest and CSS. Required manifest fields: <code>id</code>, <code>name</code>, <code>surface</code> and <code>version</code>.</p></div><textarea value={manifestText} onChange={e=>setManifestText(e.target.value)} placeholder='{"id":"MyThemeA","name":"My Theme","surface":"admin","version":"1.0.0"}'/><textarea value={cssText} onChange={e=>setCssText(e.target.value)} placeholder="Theme CSS…"/><div className={styles.actions}><button type="button" onClick={()=>void importTheme()} disabled={!manifestText.trim()||!cssText.trim()}>Import theme</button></div></section>
  {status&&<div className={styles.status}>{status}</div>}
 </main>
}
