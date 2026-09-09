"use client";
import {useEffect,useState} from "react";
import {usePathname} from "next/navigation";
import {createClient} from "@/lib/supabase";
import styles from "./AdminGuestSupportContext.module.css";
export default function AdminGuestSupportContext(){const path=usePathname(),sb=createClient(),[guest,setGuest]=useState<any>(null);const m=path.match(/^\/admin\/support\/([0-9a-f-]{36})$/i);useEffect(()=>{if(!m){setGuest(null);return}sb.from("support_tickets").select("user_id,metadata").eq("id",m[1]).maybeSingle().then(({data})=>{if(data&&!data.user_id&&data.metadata?.guest)setGuest({name:data.metadata.contact_name||"Guest",email:data.metadata.contact_email||"Email unavailable"});else setGuest(null)})},[path]);if(!guest)return null;return <div className={styles.banner}><b>Guest support request</b><span>{guest.name} · {guest.email}</span><small>No OrbitFS account is attached. Staff replies are emailed to this address.</small></div>}
