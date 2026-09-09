"use client";
import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";

type Props={entityType:"customer"|"order"|"invoice"|"support_ticket";entityId:string;title?:string};
export default function CustomerVisibleNotes({entityType,entityId,title="Notes from OrbitFS"}:Props){
 const sb=createClient(),[notes,setNotes]=useState<any[]>([]);
 useEffect(()=>{if(entityId)sb.from("staff_notes").select("id,body,created_at,updated_at").eq("entity_type",entityType).eq("entity_id",entityId).eq("visibility","customer").is("deleted_at",null).order("created_at",{ascending:false}).then(({data})=>setNotes(data||[]))},[entityId]);
 if(!notes.length)return null;
 return <section className="panel customerNotes"><div className="panelTitle"><div><h2>{title}</h2><p className="muted">Messages and notes staff have shared with you about this record.</p></div></div><div className="noteTimeline">{notes.map(n=><article className="noteCard external" key={n.id}><div className="noteMeta"><b>OrbitFS Staff</b><span>{new Date(n.created_at).toLocaleString()}</span></div><p>{n.body}</p>{n.updated_at!==n.created_at&&<small>Updated {new Date(n.updated_at).toLocaleString()}</small>}</article>)}</div></section>
}