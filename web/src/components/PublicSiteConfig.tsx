"use client";

import {useEffect} from "react";
import {usePathname} from "next/navigation";
import {createClient} from "@/lib/supabase";

const defaults:Record<string,string>={
 "site.background_color":"#07101d",
 "site.panel_color":"#0e1a2a",
 "site.border_color":"#22354c",
 "site.text_color":"#edf5ff",
 "site.muted_text_color":"#91a4bc",
 "site.primary_accent":"#4388ff",
 "site.secondary_accent":"#6ba1ff",
 "site.content_width":"1240",
 "site.card_radius":"14"
};

export default function PublicSiteConfig(){
 const path=usePathname();
 useEffect(()=>{
  if(path.startsWith("/admin")||path.startsWith("/mail"))return;
  const sb=createClient();
  let dead=false;
  sb.from("app_settings").select("key,value").eq("public_read",true).then(({data})=>{
   if(dead)return;
   const values={...defaults,...Object.fromEntries((data||[]).map((x:any)=>[x.key,String(x.value??"")]))};
   const root=document.documentElement;
   root.style.setProperty("--bg",values["site.background_color"]||defaults["site.background_color"]);
   root.style.setProperty("--panel",values["site.panel_color"]||defaults["site.panel_color"]);
   root.style.setProperty("--line",values["site.border_color"]||defaults["site.border_color"]);
   root.style.setProperty("--text",values["site.text_color"]||defaults["site.text_color"]);
   root.style.setProperty("--muted",values["site.muted_text_color"]||defaults["site.muted_text_color"]);
   root.style.setProperty("--accent",values["site.primary_accent"]||defaults["site.primary_accent"]);
   root.style.setProperty("--accent2",values["site.secondary_accent"]||defaults["site.secondary_accent"]);
   root.style.setProperty("--public-content-width",`${Math.max(720,Number(values["site.content_width"]||1240))}px`);
   root.style.setProperty("--public-card-radius",`${Math.max(0,Number(values["site.card_radius"]||14))}px`);
  });
  return()=>{dead=true};
 },[path]);
 return null;
}
