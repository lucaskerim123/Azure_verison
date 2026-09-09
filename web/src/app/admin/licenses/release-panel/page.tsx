"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

const emptyForm={channel:"update",title:"",description:"",changelog:"",customerNotes:"",internalNotes:"",severity:"normal",required:false,minimumVersion:"",rollbackVersion:"",rollout:"public",components:"core"};
const engineNames=new Set(["addons","engine","apex","mcp","studio","orbitfs_apex","orbitfs_mcp","orbitfs_studio"]);
const statusLabel=(value:any)=>String(value||"draft").replaceAll("_"," ");

export default function ReleaseGeneratorPage(){
  const sb=useMemo(()=>createClient(),[]),[data,setData]=useState<any>(null),[selected,setSelected]=useState(""),[form,setForm]=useState<any>(emptyForm),[busy,setBusy]=useState(""),[msg,setMsg]=useState("");
  async function headers():Promise<Record<string,string>>{const {data:{session}}=await sb.auth.getSession();return session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{}}
  function choose(r:any){setSelected(r.version);setForm({channel:r.channel||"update",title:r.title||`OrbitFS ${r.version}`,description:r.description||"",changelog:r.changelog||"",customerNotes:r.customerNotes||"",internalNotes:r.internalNotes||"",severity:r.severity||"normal",required:!!r.required,minimumVersion:r.minimumVersion||"",rollbackVersion:r.rollbackVersion||"",rollout:r.rollout||"public",components:(r.components||["core"]).join(",")})}
  async function load(){setBusy("load");const r=await fetch("/api/admin/orbitfs/release-system",{headers:await headers(),cache:"no-store"}),j=await r.json().catch(()=>({}));if(!r.ok)setMsg(j.error||"Could not load Release Manager.");else{setData(j);const releases=j.releases||[],same=releases.find((x:any)=>x.version===selected);if(same)choose(same);else if(releases[0])choose(releases.find((x:any)=>x.status==="draft")||releases[0])}setBusy("")}
  useEffect(()=>{void load()},[]);
  async function action(name:string,confirmText=""){if(confirmText&&!confirm(confirmText))return;setBusy(name);const release={...form,components:String(form.components||"").split(",").map((x:string)=>x.trim().toLowerCase()).filter(Boolean),minimumVersion:form.minimumVersion||null,rollbackVersion:form.rollbackVersion||null};const r=await fetch("/api/admin/orbitfs/release-system",{method:"POST",headers:{...(await headers()),"content-type":"application/json"},body:JSON.stringify({action:name,version:selected,release})}),j=await r.json().catch(()=>({}));const messages:Record<string,string>={save_release:"Release details saved.",publish_release:"Release published.",unhide_release:"Release visible and published.",hide_release:"Release hidden. Customers will no longer receive it.",withdraw_release:"Release withdrawn."};setMsg(r.ok?(messages[name]||"Action completed."):(j.error||"Release action failed."));setBusy("");if(r.ok)await load()}
  async function installAction(i:any,name:"status"|"undeploy"|"deregister"){const question=name==="undeploy"?`Undeploy ${i.installation_id}? This deletes its Vercel Panel project but keeps the customer's Supabase database.`:name==="deregister"?`Deregister ${i.installation_id}? Any Vercel Panel will be removed first. The customer's Supabase project/data will NOT be deleted.`:"";if(question&&!confirm(question))return;setBusy(`${name}:${i.id}`);const r=await fetch("/api/admin/orbitfs/release-system",{method:"POST",headers:{...(await headers()),"content-type":"application/json"},body:JSON.stringify({action:name,installationId:i.id,removePanel:true})}),j=await r.json().catch(()=>({}));setMsg(r.ok?(name==="status"?"Installation refreshed.":name==="undeploy"?"Panel undeployed; Supabase preserved.":"Installation deregistered; customer Supabase preserved."):(j.error||`${name} failed.`));setBusy("");if(r.ok)await load()}

  if(!data)return <main className="adminShell">{busy==="load"?"Loading Release Manager…":msg||"Loading…"}</main>;
  const releases=data.releases||[],engineReleases=data.engineReleases||[],installs=data.installations||[],drafts=releases.filter((r:any)=>r.status==="draft").length,published=releases.filter((r:any)=>r.status==="published").length,hidden=releases.filter((r:any)=>r.status==="paused").length,current=releases.find((r:any)=>r.version===selected),components=String(form.components||"").split(",").map((x:string)=>x.trim().toLowerCase()).filter(Boolean),needsEngine=form.channel==="update"&&components.some((x:string)=>engineNames.has(x)),engineCandidate=engineReleases.find((r:any)=>r.version===selected),engineReady=!needsEngine||!!engineCandidate&&engineCandidate.status!=="withdrawn",users=new Map<string,any>((data.users||[]).map((u:any)=>[String(u.id),u]));
  const userName=(id:string)=>{const u=users.get(String(id));return u?.display_name||u?.company_name||u?.customer_number||id};

  return <main className="adminShell">
    <header className="adminTop"><div><p className="eyebrow">LICENSING · RELEASE CONTROL</p><h1>Release Manager</h1><p className="muted">Builds stay immutable. Manage what customers see, release notes, rollout state and installation lifecycle here.</p></div><Link className="buttonlink" href="/admin/licenses">Release Panel System →</Link></header>
    <section className="stats four"><article><small>Drafts</small><strong>{drafts}</strong></article><article><small>Published</small><strong>{published}</strong></article><article><small>Hidden</small><strong>{hidden}</strong></article><article><small>Installations</small><strong>{installs.length}</strong></article></section>
    {msg&&<p className="inlineStatus" style={{marginTop:12}}>{msg}</p>}

    <section className="panel" style={{marginTop:12}}>
      <div className="panelTitle"><div><h2>Releases</h2><p className="muted">BASE_RELEASE supplies fresh installs. UPDATE_RELEASE supplies existing installations. Hidden releases are excluded from normal customer delivery.</p></div><button className="secondary" onClick={()=>void load()} disabled={busy==="load"}>Refresh</button></div>
      {!releases.length?<p className="muted">No release packages found. Run the Base GitHub Action from BASE_RELEASE or UPDATE_RELEASE.</p>:releases.map((r:any)=><button key={r.version} onClick={()=>choose(r)} className="listrow" style={{width:"100%",textAlign:"left",background:selected===r.version?"rgba(70,120,190,.13)":"transparent",border:0,borderTop:"1px solid rgba(127,127,127,.18)",cursor:"pointer"}}><div><b>{r.title||`OrbitFS ${r.version}`}{r.legacy?" · legacy package":""}</b><span>{r.version} · {String(r.channel||"base").toUpperCase()} · {statusLabel(r.status)} · schema {r.schemaVersion||"1"} · {(r.components||[]).join(", ")||"core"}</span></div><span className={`state ${r.status==="published"?"ready":"waiting"}`}>{String(r.status||"draft").toUpperCase()}</span></button>)}
    </section>

    {current&&<section className="panel" style={{marginTop:12}}>
      <div className="panelTitle"><div><h2>{current.version}</h2><p className="muted">Version, schema, checksum and source commit are package identity and cannot be edited. Release information can be edited until withdrawn.</p></div><span className={`state ${current.status==="published"?"ready":"waiting"}`}>{String(current.status).toUpperCase()}</span></div>
      {current.legacy&&<p className="inlineStatus">This is an older package without current metadata. Saving it once imports it into the current Release Manager without rebuilding the package.</p>}
      <div className="form">
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
          <label>Version<input readOnly value={current.version}/></label><label>Database schema<input readOnly value={current.schemaVersion||"1"}/></label><label>Source commit<input readOnly value={current.sourceCommit||"Legacy / unknown"}/></label>
        </div>
        <label>Channel<select value={form.channel} disabled={current.status!=="draft"||current.legacy} onChange={e=>setForm({...form,channel:e.target.value})}><option value="base">Base · new installs</option><option value="update">Update · existing installs + add-ons</option></select></label>
        <label>Release title<input disabled={current.status==="withdrawn"} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder={`OrbitFS ${current.version}`}/></label>
        <label>Description<textarea disabled={current.status==="withdrawn"} rows={3} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Short release summary"/></label>
        <label>Changelog<textarea disabled={current.status==="withdrawn"} rows={7} value={form.changelog} onChange={e=>setForm({...form,changelog:e.target.value})} placeholder={'- Added …\n- Fixed …\n- Updated …'}/></label>
        <label>Customer notes<textarea disabled={current.status==="withdrawn"} rows={4} value={form.customerNotes} onChange={e=>setForm({...form,customerNotes:e.target.value})} placeholder="What customers need to know"/></label>
        <label>Internal notes<textarea disabled={current.status==="withdrawn"} rows={3} value={form.internalNotes} onChange={e=>setForm({...form,internalNotes:e.target.value})} placeholder="Admin-only notes"/></label>
        <label>Components<input disabled={current.status==="withdrawn"} value={form.components} onChange={e=>setForm({...form,components:e.target.value})} placeholder="core,apex,mcp,studio"/><small>Comma separated. APEX, MCP and Studio remain part of the global update version.</small></label>
        {form.channel==="update"&&<div className="listrow"><div><b>Engine / add-on package</b><span>{needsEngine?(engineCandidate?`Matching ${selected} Engine candidate · ${engineCandidate.status}`:`Required for ${components.filter((x:string)=>engineNames.has(x)).join(", ")}`):"Not required for this core-only update."}</span></div><span className={`state ${engineReady?"ready":"waiting"}`}>{engineReady?"READY":"ENGINE NEEDED"}</span></div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10}}>
          <label>Severity<select disabled={current.status==="withdrawn"} value={form.severity} onChange={e=>setForm({...form,severity:e.target.value})}><option value="normal">Normal</option><option value="important">Important</option><option value="critical">Critical</option></select></label>
          <label>Rollout<select disabled={current.status==="withdrawn"} value={form.rollout} onChange={e=>setForm({...form,rollout:e.target.value})}><option value="internal">Internal</option><option value="beta">Beta</option><option value="public">Public</option></select></label>
          <label>Minimum installed version<input disabled={current.status==="withdrawn"} value={form.minimumVersion} onChange={e=>setForm({...form,minimumVersion:e.target.value})} placeholder="Optional"/></label>
          <label>Rollback target<input disabled={current.status==="withdrawn"} value={form.rollbackVersion} onChange={e=>setForm({...form,rollbackVersion:e.target.value})} placeholder="Previous known-good version"/></label>
        </div>
        <label className="toggle"><input disabled={current.status==="withdrawn"} type="checkbox" checked={!!form.required} onChange={e=>setForm({...form,required:e.target.checked})}/><span><b>Required update</b><small>Marks this release as required for compatible clients.</small></span></label>
        <div className="listrow"><div><b>Immutable package</b><span>{current.fileCount?`${current.fileCount} files · ${Math.round((current.size||0)/1024)} KB`:"Legacy package metadata will be read on first edit"} · SHA-256 {current.sha256?String(current.sha256).slice(0,16)+"…":"recorded in deployment history"}</span></div><span>{current.objectPath||`panel/${current.version}/release.json.gz`}</span></div>
        <div className="controllerActions">
          {current.status!=="withdrawn"&&<button onClick={()=>void action("save_release")} disabled={!selected||busy!==""}>Save changes</button>}
          {current.status==="draft"&&<button onClick={()=>void action("publish_release",`Publish OrbitFS ${current.version} to the ${form.channel.toUpperCase()} channel?`)} disabled={busy!==""||!engineReady}>Publish</button>}
          {current.status==="paused"&&<button onClick={()=>void action("unhide_release",`Unhide and publish ${current.version}?`)} disabled={busy!==""||!engineReady}>Unhide & publish</button>}
          {["published","superseded"].includes(current.status)&&<button className="secondary" onClick={()=>void action("hide_release",`Hide ${current.version}? If it is current, OrbitFS will fall back to the newest eligible older release.`)} disabled={busy!==""}>Hide</button>}
          {current.status!=="withdrawn"&&<button className="secondary" onClick={()=>void action("withdraw_release",`Withdraw ${current.version}? Customers will not be able to deploy or roll back to it.`)} disabled={busy!==""}>Withdraw</button>}
        </div>
      </div>
    </section>}

    <section className="panel" style={{marginTop:12}}>
      <div className="panelTitle"><div><h2>Installation lifecycle</h2><p className="muted">Administrative recovery controls. Undeploy removes only the customer's Vercel Panel. Deregister removes OrbitFS registration/tracking after undeploying, but never deletes the customer Supabase project.</p></div><span>{installs.length}</span></div>
      {installs.length?installs.map((i:any)=><div className="adminItem" key={i.id}><div><b>{userName(i.auth_user_id)} · {i.installation_id}</b><span>{statusLabel(i.state)} · DB {i.schema_version||"not initialized"} · Panel {i.release_version||"not deployed"} · health {i.health_status||"unknown"}</span><span>Supabase: {i.supabase_project_name||i.supabase_project_ref||"not selected"} · Vercel: {i.vercel_project_name||"not deployed"}</span></div><div className="controllerActions"><button className="small secondary" disabled={busy!==""} onClick={()=>void installAction(i,"status")}>Refresh</button>{i.vercel_project_id&&<button className="small secondary" disabled={busy!==""} onClick={()=>void installAction(i,"undeploy")}>Undeploy</button>}<button className="small secondary" disabled={busy!==""} onClick={()=>void installAction(i,"deregister")}>Deregister</button></div></div>):<p className="muted">No customer installations.</p>}
    </section>
  </main>;
}
