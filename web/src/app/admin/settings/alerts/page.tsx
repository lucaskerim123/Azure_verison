"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import styles from "../../alerts/alert-system.module.css";

type Row={key:string;value:any;category:string;public_read:boolean};
type Control={key:string;title:string;description:string;type:"boolean"|"number"|"select";options?:Array<{value:string;label:string}>;min?:number;max?:number};
type Group={title:string;description:string;controls:Control[]};

const typeOptions=[{value:"notification",label:"Notification"},{value:"message",label:"Message"},{value:"alert",label:"Alert"},{value:"announcement",label:"Announcement"},{value:"maintenance",label:"Maintenance"}];
const groups:Group[]=[
  {title:"System & delivery",description:"Core availability, live delivery and notification-centre behaviour.",controls:[
    {key:"alerts.enabled",title:"Alert System",description:"Master switch for OrbitFS notifications and manual dispatch.",type:"boolean"},
    {key:"alerts.manual_send_enabled",title:"Manual admin sending",description:"Allow authorised staff to send from the Alert System composer.",type:"boolean"},
    {key:"alerts.realtime_enabled",title:"Realtime delivery",description:"Push new items into notification centres without a page reload.",type:"boolean"},
    {key:"alerts.action_links_enabled",title:"Internal action links",description:"Allow alerts to open an OrbitFS admin or portal path.",type:"boolean"},
    {key:"alerts.feed_limit",title:"Notification feed size",description:"Recent items loaded per notification centre.",type:"number",min:10,max:100}
  ]},
  {title:"Composer defaults & safety",description:"Defaults used when an admin opens the composer plus bulk-send limits.",controls:[
    {key:"alerts.default_type",title:"Default type",description:"Initial alert type for a new dispatch.",type:"select",options:typeOptions},
    {key:"alerts.default_severity",title:"Default severity",description:"Initial visual severity for a new dispatch.",type:"select",options:[{value:"info",label:"Info"},{value:"success",label:"Success"},{value:"warning",label:"Warning"},{value:"error",label:"Critical / error"}]},
    {key:"alerts.default_audience",title:"Default audience",description:"Initial audience when the composer opens.",type:"select",options:[{value:"selected",label:"Selected people"},{value:"customers",label:"Customers"},{value:"staff",label:"Active staff"},{value:"everyone",label:"Everyone"}]},
    {key:"alerts.confirmation_threshold",title:"Bulk confirmation at",description:"Require confirmation when a send reaches this many recipients.",type:"number",min:1,max:10000},
    {key:"alerts.max_message_length",title:"Maximum message length",description:"Hard character limit enforced by the composer and backend.",type:"number",min:100,max:4000}
  ]},
  {title:"Available alert types",description:"Choose which message types administrators can manually send.",controls:[
    {key:"alerts.type_notification_enabled",title:"Notification",description:"Standard informational notification.",type:"boolean"},
    {key:"alerts.type_message_enabled",title:"Message",description:"Direct administrative message.",type:"boolean"},
    {key:"alerts.type_alert_enabled",title:"Alert",description:"Attention-required operational warning.",type:"boolean"},
    {key:"alerts.type_announcement_enabled",title:"Announcement",description:"Targeted or platform-wide announcement.",type:"boolean"},
    {key:"alerts.type_maintenance_enabled",title:"Maintenance",description:"Service maintenance or disruption notice.",type:"boolean"}
  ]}
];

export default function OrbitFSAlertSettingsPage(){
  const [sb]=useState(()=>createClient());
  const [rows,setRows]=useState<Row[]>([]);
  const [initial,setInitial]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");

  useEffect(()=>{
    (async()=>{
      const {data,error}=await sb.from("app_settings").select("key,value,category,public_read").eq("category","alerts").order("key");
      if(error){setMessage(error.message);setLoading(false);return}
      const loaded=(data||[]) as Row[];
      setRows(loaded);
      setInitial(Object.fromEntries(loaded.map(r=>[r.key,JSON.stringify(r.value)])));
      setLoading(false);
    })();
  },[sb]);

  const map=useMemo(()=>Object.fromEntries(rows.map((r,i)=>[r.key,{row:r,index:i}])),[rows]);
  const dirty=rows.filter(r=>initial[r.key]!==JSON.stringify(r.value)).length;

  function change(key:string,value:any){
    const found=map[key];if(!found)return;
    setRows(current=>current.map((r,i)=>i===found.index?{...r,value}:r));
    setMessage("");
  }

  async function save(){
    setMessage("Saving Alert System configuration…");
    for(const r of rows){
      if(initial[r.key]===JSON.stringify(r.value))continue;
      const {error}=await sb.from("app_settings").update({value:r.value,updated_at:new Date().toISOString()}).eq("key",r.key);
      if(error){setMessage(error.message);return}
    }
    setInitial(Object.fromEntries(rows.map(r=>[r.key,JSON.stringify(r.value)])));
    setMessage("OrbitFS Alert System settings saved and applied.");
  }

  if(loading)return <main className={styles.settingsShell}><section className={styles.settingsGroup}><div style={{padding:16}}>Loading Alert System settings…</div></section></main>;

  return <main className={styles.settingsShell}>
    <header className={styles.settingsHeader}>
      <div><p className={styles.eyebrow}>SYSTEM · ALERT CONFIG</p><h1>Alert System settings</h1><p>Delivery, defaults, safety limits and enabled message types.</p></div>
      <Link href="/admin/alerts">Open composer →</Link>
    </header>

    {groups.map((group,index)=><details className={styles.settingsGroup} key={group.title} open={index<2}>
      <summary><div><h2>{group.title}</h2><p>{group.description}</p></div><b>⌄</b></summary>
      <div className={styles.settingsRows}>{group.controls.map(control=>{
        const found=map[control.key];if(!found)return null;
        const value=found.row.value;
        return <article className={styles.settingRow} key={control.key}>
          <div><h3>{control.title}</h3><p>{control.description}</p></div>
          <div className={styles.settingControl}>
            {control.type==="boolean"?<div className={styles.toggle}><button type="button" className={value===true?styles.toggleActive:""} onClick={()=>change(control.key,true)}>On</button><button type="button" className={value===false?styles.toggleActive:""} onClick={()=>change(control.key,false)}>Off</button></div>
            :control.type==="select"?<select value={String(value??"")} onChange={e=>change(control.key,e.target.value)}>{control.options?.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
            :<input type="number" min={control.min} max={control.max} value={Number(value||0)} onChange={e=>change(control.key,Math.max(control.min||0,Math.min(control.max||Number.MAX_SAFE_INTEGER,Number(e.target.value||0))))}/>} 
          </div>
        </article>;
      })}</div>
    </details>)}

    {message&&<p className={styles.settingsMessage}>{message}</p>}
    <div className={styles.saveBar}><div><b>{dirty?`${dirty} unsaved change${dirty===1?"":"s"}`:"Saved"}</b><span>Live Supabase configuration.</span></div><button type="button" onClick={()=>void save()} disabled={dirty===0}>Save</button></div>
  </main>;
}
