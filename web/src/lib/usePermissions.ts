"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

export function usePermissions(){
 const sb=useMemo(()=>createClient(),[]);
 const [role,setRole]=useState<string|null>(null),[permissions,setPermissions]=useState<Record<string,boolean>>({}),[groups,setGroups]=useState<any[]>([]);
 useEffect(()=>{let live=true;(async()=>{const {data:{user}}=await sb.auth.getUser();if(!live||!user)return;const {data}=await sb.rpc("get_my_staff_access");if(!live)return;const a:any=data||{};setRole(a.is_staff?a.primary_role:"user");setPermissions(a.permissions||{});setGroups(a.groups||[])})();return()=>{live=false}},[sb]);
 const can=useCallback((key:string)=>!!permissions.all||!!permissions[key],[permissions]);
 return{role,permissions,groups,can,ready:role!==null};
}
