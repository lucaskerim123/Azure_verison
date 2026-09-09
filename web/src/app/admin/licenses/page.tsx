"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

const STORE_ORIGIN="https://orbitfsstore.vercel.app";
const sectionStyle={marginTop:12} as const;
const summaryStyle={cursor:"pointer"} as const;

export default function OrbitReleasePanelSystem(){
  const sb=useMemo(()=>createClient(),[]);
  const [data,setData]=useState<any>();
  const [s,setS]=useState<any>();
  const [msg,setMsg]=useState("");
  const [busy,setBusy]=useState("");
  const [publisherToken,setPublisherToken]=useState("");
  const [secrets,setSecrets]=useState({supabase:"",vercel:""});

  async function headers():Promise<Record<string,string>>{const {data:{session}}=await sb.auth.getSession();return session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{}}
  async function load(preserveSettings=false){setBusy("load");const h=await headers();const r=await fetch("/api/admin/orbitfs/release-system",{headers:h,cache:"no-store"});const j=await r.json().catch(()=>({}));if(!r.ok)setMsg(j.error||"Could not load Release Panel System.");else{setData(j);if(!preserveSettings)setS(j.snapshot?.settings||{})}setBusy("")}
  useEffect(()=>{void load()},[]);

  async function save(){setBusy("save");const {data:d,error}=await sb.rpc("admin_update_orbitfs_release_system",{p_patch:s});setMsg(error?.message||"Release Panel System settings saved.");if(!error)setS(d);setBusy("");return !error}
  async function saveConnector(provider:"supabase"|"vercel"){
    setBusy(provider);
    const {data:d,error:settingsError}=await sb.rpc("admin_update_orbitfs_release_system",{p_patch:s});
    if(settingsError){setMsg(settingsError.message);setBusy("");return}
    setS(d);
    const secretConfigured=provider==="supabase"?!!data?.snapshot?.supabase_client_secret_configured:!!data?.snapshot?.vercel_client_secret_configured;
    const value=secrets[provider].trim();
    if(!secretConfigured&&!value){setMsg(`Enter the ${provider==="supabase"?"Supabase":"Vercel"} client secret.`);setBusy("");return}
    if(value){const {error}=await sb.rpc("admin_store_orbitfs_release_secret",{p_key:`${provider}_client_secret`,p_value:value});if(error){setMsg(error.message);setBusy("");return}setSecrets(current=>({...current,[provider]:""}))}
    setMsg(`${provider==="supabase"?"Supabase":"Vercel"} connector saved.`);
    setBusy("");
    await load(true);
  }
  async function removeSecret(provider:"supabase"|"vercel"){if(!confirm(`Remove the ${provider} connector secret?`))return;const {error}=await sb.rpc("admin_remove_orbitfs_release_secret",{p_key:`${provider}_client_secret`});setMsg(error?.message||"Connector secret removed.");if(!error)void load(true)}
  async function generatePublisherToken(){if(data?.snapshot?.panel_publish_token_configured&&!confirm("Rotate the Panel publisher token? GitHub Actions will need the new value."))return;const bytes=crypto.getRandomValues(new Uint8Array(32)),token=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");const {error}=await sb.rpc("admin_store_orbitfs_release_secret",{p_key:"panel_publish_token",p_value:token});if(error)return setMsg(error.message);setPublisherToken(token);setMsg("Publisher token created. Copy it to the Base repo GitHub Actions secret before leaving this page.");void load(true)}
  async function removePublisher(){if(!confirm("Remove the Panel publisher token? Publishing will stop until a new token is configured."))return;const {error}=await sb.rpc("admin_remove_orbitfs_release_secret",{p_key:"panel_publish_token"});setMsg(error?.message||"Panel publisher token removed.");setPublisherToken("");if(!error)void load(true)}
  async function api(body:any){setBusy(body.action||"action");const h=await headers();const r=await fetch("/api/admin/orbitfs/release-system",{method:"POST",headers:{...h,"content-type":"application/json"},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));setMsg(r.ok?"Action accepted.":j.error||"Action failed.");setBusy("");if(r.ok)void load(true);return j}
  async function uploadSchema(file:File|null){if(!file)return;await api({action:"upload_schema",sql:await file.text()})}
  async function installAction(i:any,action:string){let version:string|undefined;if(action==="rollback"){version=prompt("Panel release version to roll back to:",i.previous_release_version||"")||undefined;if(!version)return}if(!confirm(`${action} ${i.installation_id}${version?` to ${version}`:""}?`))return;await api({action,installationId:i.id,version})}

  if(!s)return <main className="adminShell">Loading Orbit Release Panel System…</main>;

  const snap=data?.snapshot||{},releases=data?.releases||[],installs=data?.installations||[],events=data?.events||[],users=new Map((data?.users||[]).map((u:any)=>[u.id,u]));
  const userName=(id:string)=>{const u:any=users.get(id);return u?.display_name||u?.company_name||u?.customer_number||id};
  const supabaseCallback=`${STORE_ORIGIN}/api/orbitfs/oauth/supabase/callback`;
  const vercelCallback=`${STORE_ORIGIN}/api/orbitfs/oauth/vercel/callback`;
  const missingSetup=[
    !s.supabase_client_id&&"Supabase client ID",
    !snap.supabase_client_secret_configured&&"Supabase client secret",
    !s.vercel_client_id&&"Vercel client ID",
    !snap.vercel_client_secret_configured&&"Vercel client secret",
    !snap.panel_publish_token_configured&&"Panel publisher token",
    !data?.schema?.configured&&"Base schema",
    !data?.latest?.version&&"first Panel release"
  ].filter(Boolean) as string[];
  const configured=missingSetup.length===0;

  return <main className="adminShell">
    <header className="adminTop">
      <div><p className="eyebrow">LICENSING · RELEASE CONTROL</p><h1>Orbit Release Panel System</h1><p className="muted">Store-side control for customer-owned OrbitFS deployments and updates.</p></div>
      <Link className="buttonlink" href="/admin/licenses/manage">Licences →</Link>
    </header>

    <section className="stats four">
      <article><small>System</small><strong>{s.enabled?"Enabled":"Disabled"}</strong></article>
      <article><small>Setup</small><strong>{configured?"Ready":`Needs ${missingSetup.length}`}</strong></article>
      <article><small>Latest Panel</small><strong>{data?.latest?.version||"None"}</strong></article>
      <article><small>Installations</small><strong>{snap.installations??installs.length}</strong></article>
    </section>
    {!configured&&<p className="muted" style={sectionStyle}><b>Still required:</b> {missingSetup.join(" · ")}</p>}

    <section className="panel" style={sectionStyle}>
      <div className="panelTitle"><div><h2>Customer-owned deployment</h2><p className="muted">OrbitFS only brokers the connection and publishes the licensed software.</p></div><span className="state ready">ISOLATED</span></div>
      <div className="listrow"><div><b>Supabase</b><span>Customers sign into their own Supabase account and choose/create a project in their own organization.</span></div><span>Customer account</span></div>
      <div className="listrow"><div><b>Vercel</b><span>Customers authorize the OrbitFS Vercel App from their own account. Their Panel project is created there.</span></div><span>Customer account</span></div>
      <p className="muted">The OrbitFS Store database and your development projects are control/source systems only and are not customer deployment targets.</p>
    </section>

    <details className="panel" style={sectionStyle} open>
      <summary className="panelTitle" style={summaryStyle}><div><h2>Master control</h2><p className="muted">Enable or stop the deployment/update service without touching installed customer data.</p></div><span className={`state ${s.enabled?"ready":"waiting"}`}>{s.enabled?"ON":"OFF"}</span></summary>
      <div className="form">
        <label className="toggle"><input type="checkbox" checked={!!s.enabled} onChange={e=>setS({...s,enabled:e.target.checked})}/><span><b>Enable Release Panel System</b><small>Master switch.</small></span></label>
        <label className="toggle"><input type="checkbox" checked={!!s.customer_deploy_enabled} onChange={e=>setS({...s,customer_deploy_enabled:e.target.checked})}/><span><b>Allow new customer deployments</b></span></label>
        <label className="toggle"><input type="checkbox" checked={!!s.customer_updates_enabled} onChange={e=>setS({...s,customer_updates_enabled:e.target.checked})}/><span><b>Allow customer updates</b><small>Updates reuse the same customer Supabase + Vercel projects.</small></span></label>
        <label className="toggle"><input type="checkbox" checked={!!s.customer_rollbacks_enabled} onChange={e=>setS({...s,customer_rollbacks_enabled:e.target.checked})}/><span><b>Allow code rollback</b><small>Panel code only. Database rollback is never automatic.</small></span></label>
        <button onClick={save} disabled={busy==="save"}>{busy==="save"?"Saving…":"Save controls"}</button>
      </div>
    </details>

    <details className="panel" style={sectionStyle}>
      <summary className="panelTitle" style={summaryStyle}><div><h2>Supabase customer connector</h2><p className="muted">One OrbitFS OAuth App. Each customer authorizes their own Supabase account.</p></div><span className={`state ${snap.supabase_client_secret_configured&&s.supabase_client_id?"ready":"waiting"}`}>{snap.supabase_client_secret_configured&&s.supabase_client_id?"Ready":"Setup"}</span></summary>
      <div className="form">
        <p className="muted">These credentials identify the <b>OrbitFS OAuth App</b>; they are not a Supabase account used to host customers.</p>
        <label className="toggle"><input type="checkbox" checked={!!s.supabase_oauth_enabled} onChange={e=>setS({...s,supabase_oauth_enabled:e.target.checked})}/>Enable customer Supabase connection</label>
        <label>OAuth App client ID<input value={s.supabase_client_id||""} onChange={e=>setS({...s,supabase_client_id:e.target.value})}/></label>
        <label>OAuth App client secret<input type="password" value={secrets.supabase} onChange={e=>setSecrets({...secrets,supabase:e.target.value})} placeholder={snap.supabase_client_secret_configured?"Configured — leave blank to keep":"Enter client secret"}/></label>
        <label>OAuth callback URL<input readOnly value={supabaseCallback}/></label>
        <small>Configure the required Management API permissions on the Supabase OAuth App itself. Customers grant those permissions when they connect.</small>
        <label className="toggle"><input type="checkbox" checked={!!s.allow_create_supabase_project} onChange={e=>setS({...s,allow_create_supabase_project:e.target.checked})}/>Allow customers to create a dedicated OrbitFS project</label>
        <label className="toggle"><input type="checkbox" checked={!!s.allow_existing_supabase_project} onChange={e=>setS({...s,allow_existing_supabase_project:e.target.checked})}/>Allow customers to select an existing project</label>
        <label>Default region<input value={s.default_supabase_region||""} onChange={e=>setS({...s,default_supabase_region:e.target.value})}/></label>
        <div className="controllerActions"><button onClick={()=>void saveConnector("supabase")} disabled={busy==="supabase"}>{busy==="supabase"?"Saving…":"Save Supabase connector"}</button>{snap.supabase_client_secret_configured&&<button className="secondary" onClick={()=>removeSecret("supabase")}>Remove secret</button>}</div>
      </div>
    </details>

    <details className="panel" style={sectionStyle}>
      <summary className="panelTitle" style={summaryStyle}><div><h2>Vercel customer connector</h2><p className="muted">One OrbitFS Vercel App. Each customer authorizes it from their own Vercel account.</p></div><span className={`state ${snap.vercel_client_secret_configured&&s.vercel_client_id?"ready":"waiting"}`}>{snap.vercel_client_secret_configured&&s.vercel_client_id?"Ready":"Setup"}</span></summary>
      <div className="form">
        <p className="muted">Use a <b>Vercel App</b>, not a Marketplace/Native Integration. OrbitFS uses Vercel OAuth and the customer's own Vercel account.</p>
        <label className="toggle"><input type="checkbox" checked={!!s.vercel_oauth_enabled} onChange={e=>setS({...s,vercel_oauth_enabled:e.target.checked})}/>Enable customer Vercel connection</label>
        <label>Vercel App client ID<input value={s.vercel_client_id||""} onChange={e=>setS({...s,vercel_client_id:e.target.value})}/></label>
        <label>Vercel App client secret<input type="password" value={secrets.vercel} onChange={e=>setSecrets({...secrets,vercel:e.target.value})} placeholder={snap.vercel_client_secret_configured?"Configured — leave blank to keep":"Enter client secret"}/></label>
        <label>Authorization endpoint<input readOnly value="https://vercel.com/oauth/authorize"/></label>
        <label>Callback URL<input readOnly value={vercelCallback}/></label>
        <small>The old /integrations/&lt;slug&gt;/new install URL is not used. Marketplace fields such as productsBaseUrl, SSO, EULA and featured images are not part of this connector.</small>
        <label>Customer Panel project prefix<input value={s.panel_project_prefix||""} onChange={e=>setS({...s,panel_project_prefix:e.target.value})}/></label>
        <label>Panel health path<input value={s.health_path||"/api/health"} onChange={e=>setS({...s,health_path:e.target.value})}/></label>
        <div className="controllerActions"><button onClick={()=>void saveConnector("vercel")} disabled={busy==="vercel"}>{busy==="vercel"?"Saving…":"Save Vercel connector"}</button>{snap.vercel_client_secret_configured&&<button className="secondary" onClick={()=>removeSecret("vercel")}>Remove secret</button>}</div>
      </div>
    </details>

    <details className="panel" style={sectionStyle}>
      <summary className="panelTitle" style={summaryStyle}><div><h2>Private Panel publisher</h2><p className="muted">Base GitHub → private Store release package.</p></div><span className={`state ${snap.panel_publish_token_configured?"ready":"waiting"}`}>{snap.panel_publish_token_configured?"Ready":"Setup"}</span></summary>
      <div className="form">
        <button onClick={generatePublisherToken}>{snap.panel_publish_token_configured?"Rotate publisher token":"Generate publisher token"}</button>
        {snap.panel_publish_token_configured&&<button className="secondary" onClick={removePublisher}>Remove publisher token</button>}
        {publisherToken&&<><label>New token — shown once<input readOnly value={publisherToken}/></label><button className="secondary" onClick={()=>navigator.clipboard.writeText(publisherToken)}>Copy token</button></>}
        <small>Copy the same value to <b>V1-vercel-base → Actions secret → ORBITFS_PANEL_RELEASE_PUBLISH_TOKEN</b>. The Store copy is in Supabase Vault.</small>
      </div>
    </details>

    <details className="panel" style={sectionStyle}>
      <summary className="panelTitle" style={summaryStyle}><div><h2>Fresh Base database</h2><p className="muted">Blank schema installed into each customer's selected Supabase project.</p></div><span className={`state ${data?.schema?.configured?"ready":"waiting"}`}>{data?.schema?.configured?`Schema ${s.schema_version}`:"Missing"}</span></summary>
      <div className="form">
        <label>Schema version<input value={s.schema_version||""} onChange={e=>setS({...s,schema_version:e.target.value})}/></label>
        <label>Private Store bucket<input value={s.schema_bucket||""} onChange={e=>setS({...s,schema_bucket:e.target.value})}/></label>
        <label>Schema asset path<input value={s.schema_path||""} onChange={e=>setS({...s,schema_path:e.target.value})}/></label>
        <label>Upload fresh blank schema<input type="file" accept=".sql,.txt,text/plain" onChange={e=>void uploadSchema(e.target.files?.[0]||null)}/></label>
        <small>{data?.schema?.configured?`${data.schema.size||0} bytes stored privately in the Store control plane.`:"Upload the fresh blank Base schema before enabling deployment."}</small>
        <button onClick={save}>Save schema settings</button>
      </div>
    </details>

    <details className="panel" style={sectionStyle}>
      <summary className="panelTitle" style={summaryStyle}><div><h2>Private Panel releases</h2><p className="muted">Published Base builds available for deploy/update.</p></div><span>{releases.length}</span></summary>
      {releases.length?releases.map((r:any)=><div className="listrow" key={r.version}><div><b>{r.version}{r.version===data?.latest?.version?" · latest":""}</b><span>DB schema {r.schemaVersion||"1"} · {r.fileCount} files · {r.sourceCommit||"no commit"}</span></div><span>{r.publishedAt?new Date(r.publishedAt).toLocaleString():""}</span></div>):<p className="muted">No Panel release published yet.</p>}
    </details>

    <details className="panel" style={sectionStyle} open={installs.length>0}>
      <summary className="panelTitle" style={summaryStyle}><div><h2>Customer installations</h2><p className="muted">Customer-owned Supabase + Vercel installations.</p></div><span>{installs.length}</span></summary>
      {installs.length?installs.map((i:any)=><div className="adminItem" key={i.id}><div><b>{userName(i.auth_user_id)} · {i.installation_id}</b><span>{i.state} · health {i.health_status||"unknown"} · Panel {i.release_version||"not deployed"} · DB {i.schema_version||"—"}</span><span>Customer Supabase: {i.supabase_project_name||i.supabase_project_ref||"not connected"} · Customer Vercel: {i.vercel_project_name||"not connected"}</span>{i.production_url&&<span>{i.production_url}</span>}{i.last_error&&<span>{i.last_error}</span>}</div><div className="controllerActions"><button className="small secondary" onClick={()=>void api({action:"status",installationId:i.id})}>Refresh</button>{i.database_initialized_at&&<button className="small secondary" onClick={()=>void installAction(i,"redeploy")}>Redeploy</button>}{i.release_version&&data?.latest?.version&&i.release_version!==data.latest.version&&<button className="small" onClick={()=>void installAction(i,"update")}>Update</button>}{i.release_version&&<button className="small secondary" onClick={()=>void installAction(i,"rollback")}>Rollback</button>}</div></div>):<p className="muted">No customer installations yet.</p>}
    </details>

    <details className="panel" style={sectionStyle}>
      <summary className="panelTitle" style={summaryStyle}><div><h2>Deployment events</h2><p className="muted">Recent setup/deploy activity.</p></div><span>{events.length}</span></summary>
      {events.length?events.slice(0,50).map((e:any)=><div className="listrow" key={e.id}><div><b>{e.event_type}</b><span>{e.message||e.status}</span></div><span>{new Date(e.created_at).toLocaleString()}</span></div>):<p className="muted">No deployment events yet.</p>}
    </details>

    <div className="controllerActions" style={{marginTop:12}}><button onClick={save}>Save configuration</button><button className="secondary" onClick={()=>void load()} disabled={busy==="load"}>{busy==="load"?"Refreshing…":"Refresh"}</button></div>
    <p className="inlineStatus">{msg}</p>
  </main>;
}
