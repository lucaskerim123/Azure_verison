const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||'https://zekejuprrsurjmwgzexw.supabase.co';
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_eRN8I1CeZ6zHu-mxK0Zc7g_yO47io5c';

type RuntimeOptions={
  authorization?:string;
  origin:string;
  body?:unknown;
  rawBody?:string;
  headers?:Record<string,string>;
  query?:Record<string,string|undefined|null>;
};

export async function paymentRuntime(action:string,options:RuntimeOptions){
  const url=new URL(`${SUPABASE_URL}/functions/v1/payment-runtime`);
  url.searchParams.set('action',action);
  for(const [key,value] of Object.entries(options.query||{}))if(value!=null&&value!=='')url.searchParams.set(key,String(value));
  const headers:Record<string,string>={apikey:SUPABASE_KEY,'x-orbitfs-origin':options.origin,...(options.headers||{})};
  if(options.authorization)headers.authorization=options.authorization;
  let body:BodyInit|undefined;
  if(options.rawBody!=null)body=options.rawBody;
  else if(options.body!==undefined){headers['content-type']='application/json';body=JSON.stringify(options.body)}
  return fetch(url,{method:'POST',headers,body,cache:'no-store'});
}

export async function runtimeJson(response:Response){
  return response.json().catch(()=>({error:`Payment runtime failed (${response.status})`}));
}
