var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OrbitFS Licence Admin</title><style>:root{color-scheme:dark;font-family:system-ui;background:#090e17;color:#eef4ff}*{box-sizing:border-box}body{margin:0}header{padding:16px 20px;border-bottom:1px solid #2d3d57;display:flex;justify-content:space-between;align-items:center}.wrap{max-width:1180px;margin:auto;padding:20px}.card{background:#111a29;border:1px solid #2d3d57;border-radius:10px;padding:15px;margin-bottom:14px}.grid{display:grid;gap:12px}.two{grid-template-columns:1fr 1fr}.stats{grid-template-columns:repeat(5,1fr)}input,textarea,select,button{width:100%;padding:10px;border:1px solid #3b4e6d;border-radius:8px;background:#0a1220;color:#fff}button{cursor:pointer;background:#256ed6;font-weight:700}.secondary{background:#17243a}.danger{background:#58232b}.nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.nav button{width:auto}.hidden{display:none}.muted{color:#9aabc1;font-size:13px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row>*{width:auto}.item{border-top:1px solid #2d3d57;padding:12px 0}.key{word-break:break-all;border:1px solid #347458;background:#10271f;padding:12px;border-radius:8px}.products label{display:block;padding:6px}.products input{width:auto}.good{color:#4bd19b}.bad{color:#ff7b86}pre{white-space:pre-wrap;word-break:break-word;background:#08101c;padding:12px;border-radius:8px}@media(max-width:760px){.two,.stats{grid-template-columns:1fr}.wrap{padding:12px}}</style></head><body><section id="gate" class="wrap" style="max-width:430px;padding-top:10vh"><div class="card"><h1>OrbitFS Licence Admin</h1><form id="authForm" class="grid"><input id="adminUser" placeholder="Username" required><input id="adminPin" type="password" placeholder="PIN" required><input id="adminPassword" type="password" placeholder="Password" required><button id="authButton">Sign in</button><p id="authError" class="bad"></p></form></div></section><section id="app" class="hidden"><header><div><b>OrbitFS Licence Admin</b><div class="muted">Cloudflare Worker + D1</div></div><div class="row"><a href="/portal" style="color:#9fc5ff">User portal</a><button id="logout" class="secondary">Sign out</button></div></header><main class="wrap"><nav class="nav"><button data-view="dashboard">Dashboard</button><button data-view="issue">Issue licence</button><button data-view="manage">Manage licences</button><button data-view="users">Users</button><button data-view="validate">Validate licence</button></nav><section id="dashboard" class="view"><div id="stats" class="grid stats"></div><div class="card"><h3>Validation service</h3><div id="service"></div></div></section><section id="issue" class="view hidden"><div class="card"><h2>Issue licence</h2><form id="issueForm" class="grid"><div class="grid two"><input id="issueLabel" placeholder="Customer or licence label" required><input id="issueExpiry" type="date"><select id="issueUser"><option value="">No linked user</option></select></div><textarea id="issueNotes" placeholder="Notes"></textarea><div id="issueProducts" class="products"></div><button>Issue and copy key</button></form><div id="issuedKey"></div></div></section><section id="manage" class="view hidden"><div class="card"><h2>Manage licences</h2><input id="licenceSearch" placeholder="Search licences"><div id="licenceList"></div></div><div id="licenceEditor" class="card hidden"></div></section><section id="users" class="view hidden"><div class="grid two"><div class="card"><h2>Create user</h2><form id="userForm" class="grid"><input id="userName" placeholder="Name" required><input id="userEmail" type="email" placeholder="Email" required><input id="userPin" type="password" inputmode="numeric" placeholder="PIN" required><button>Create user</button></form></div><div class="card"><h2>Licence users</h2><div id="userList"></div></div></div></section><section id="validate" class="view hidden"><div class="card"><h2>Validate licence</h2><form id="validateForm" class="grid"><input id="validateKey" placeholder="OFS-XXXX-XXXX-XXXX-XXXX" required><input id="validateInstall" placeholder="Installation ID" required><label><input id="validateActivate" type="checkbox" style="width:auto"> Activate unlocked products</label><button>Validate</button></form><pre id="validateResult"></pre></div></section></main></section><script>const $=s=>document.querySelector(s);const gate=$('#gate'),authForm=$('#authForm'),adminUser=$('#adminUser'),adminPin=$('#adminPin'),adminPassword=$('#adminPassword'),authButton=$('#authButton'),authError=$('#authError'),app=$('#app'),logout=$('#logout'),dashboard=$('#dashboard'),stats=$('#stats'),service=$('#service'),issue=$('#issue'),issueForm=$('#issueForm'),issueLabel=$('#issueLabel'),issueExpiry=$('#issueExpiry'),issueUser=$('#issueUser'),issueNotes=$('#issueNotes'),issueProducts=$('#issueProducts'),issuedKey=$('#issuedKey'),manage=$('#manage'),licenceSearch=$('#licenceSearch'),licenceList=$('#licenceList'),licenceEditor=$('#licenceEditor'),users=$('#users'),userForm=$('#userForm'),userName=$('#userName'),userEmail=$('#userEmail'),userPin=$('#userPin'),userList=$('#userList'),validate=$('#validate'),validateForm=$('#validateForm'),validateKey=$('#validateKey'),validateInstall=$('#validateInstall'),validateActivate=$('#validateActivate'),validateResult=$('#validateResult');const state={products:[],licences:[],users:[],detail:null};async function api(p,o={}){const r=await fetch(p,{credentials:'include',headers:{'content-type':'application/json'},...o});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||b.detail||'Request failed');return b}function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function showApp(){gate.classList.add('hidden');app.classList.remove('hidden')}async function loadAll(){const [p,l,u,h,r]=await Promise.all([api('/api/admin/products'),api('/api/admin/licenses'),api('/api/admin/users'),api('/health'),api('/api/license/revision')]);state.products=p.products;state.licences=l.licences;state.users=u.users;renderAll(h,r)}function renderAll(h,r){const soon=Date.now()+30*864e5;const vals=[['Total',state.licences.length],['Active',state.licences.filter(x=>x.status==='active').length],['Blocked',state.licences.filter(x=>x.status==='blocked').length],['Locked',state.licences.filter(x=>Number(x.locked)>0).length],['Expiring',state.licences.filter(x=>x.expires_at&&Date.parse(x.expires_at)<=soon).length]];stats.innerHTML=vals.map(x=>'<div class="card"><div class="muted">'+x[0]+'</div><h2>'+x[1]+'</h2></div>').join('');service.innerHTML='<p class="good">Online</p><p>Endpoint: <code>/api/license/validate</code></p><p>Revision: '+esc(r.revision)+'</p><p class="muted">Every OrbitFS installation should validate against this Worker endpoint.</p>';issueProducts.innerHTML=state.products.map(p=>'<label><input type="checkbox" data-issue-product="'+esc(p.id)+'" checked> '+esc(p.name)+'</label>').join('');issueUser.innerHTML='<option value="">No linked user</option>'+state.users.map(u=>'<option value="'+esc(u.id)+'">'+esc(u.name)+' \u2014 '+esc(u.email)+'</option>').join('');renderLicences();renderUsers()}function renderLicences(){const q=licenceSearch.value.toLowerCase();const rows=state.licences.filter(x=>(x.label+' '+x.id).toLowerCase().includes(q));licenceList.innerHTML=rows.map(x=>'<div class="item"><b>'+esc(x.label)+'</b> <span class="'+(x.status==='active'?'good':'bad')+'">'+esc(x.status)+'</span><div class="muted">'+esc(x.id)+' \xB7 '+esc(x.components||'No products')+' \xB7 '+Number(x.locked)+' locks</div><button class="secondary" data-manage="'+esc(x.id)+'">Manage</button></div>').join('')||'<p class="muted">No licences.</p>'}function renderUsers(){userList.innerHTML=state.users.map(u=>'<div class="item"><b>'+esc(u.name)+'</b> <span class="'+(u.status==='active'?'good':'bad')+'">'+esc(u.status)+'</span><div class="muted">'+esc(u.email)+'</div><div class="row"><button class="secondary" data-user-status="'+esc(u.id)+'" data-next="'+(u.status==='active'?'blocked':'active')+'">'+(u.status==='active'?'Block':'Unblock')+'</button><button class="secondary" data-reset-pin="'+esc(u.id)+'">Reset PIN</button></div></div>').join('')||'<p class="muted">No users.</p>'}async function openLicence(id){state.detail=await api('/api/admin/licenses/'+encodeURIComponent(id)+'/detail');const d=state.detail,l=d.licence;licenceEditor.classList.remove('hidden');licenceEditor.innerHTML='<h2>'+esc(l.label)+'</h2><div class="grid two"><select id="editStatus"><option value="active" '+(l.status==='active'?'selected':'')+'>Active</option><option value="blocked" '+(l.status==='blocked'?'selected':'')+'>Blocked</option></select><input id="editExpiry" type="date" value="'+esc((l.expires_at||'').slice(0,10))+'"><select id="editUser"><option value="">No linked user</option>'+state.users.map(u=>'<option value="'+esc(u.id)+'" '+(u.id===l.user_id?'selected':'')+'>'+esc(u.name)+' \u2014 '+esc(u.email)+'</option>').join('')+'</select><textarea id="editNotes" placeholder="Notes">'+esc(l.notes||'')+'</textarea></div><h3>Products and locks</h3><div id="editProducts" class="products">'+d.components.map(c=>'<label><input type="checkbox" data-edit-product="'+esc(c.component)+'" '+(Number(c.enabled)===1?'checked':'')+'> '+esc(state.products.find(p=>p.id===c.component)?.name||c.component)+' <span class="muted">'+(c.installation_id?'Locked: '+esc(c.installation_id):'Unlocked')+'</span> '+(c.installation_id?'<button class="secondary" data-unlock-component="'+esc(c.component)+'">Unlock</button>':'')+'</label>').join('')+'</div><div class="row"><button id="saveLicence">Save changes</button><button id="rotateLicence" class="danger">Rotate key</button><button id="unlockLicence" class="secondary">Unlock all</button><button id="deleteLicence" class="danger">Delete licence</button></div><div id="manageKey"></div><h3>Audit history</h3><div>'+d.audit.map(a=>'<div class="item"><b>'+esc(a.action)+'</b><div class="muted">'+esc(a.created_at)+' '+esc(a.detail||'')+'</div></div>').join('')+'</div>';const editStatus=$('#editStatus'),editExpiry=$('#editExpiry'),editUser=$('#editUser'),editNotes=$('#editNotes'),editProducts=$('#editProducts'),saveLicence=$('#saveLicence'),rotateLicence=$('#rotateLicence'),unlockLicence=$('#unlockLicence'),deleteLicence=$('#deleteLicence'),manageKey=$('#manageKey');saveLicence.onclick=async()=>{const components={};document.querySelectorAll('[data-edit-product]').forEach(x=>components[x.dataset.editProduct]=x.checked);await api('/api/admin/licenses/'+encodeURIComponent(l.id),{method:'PATCH',body:JSON.stringify({status:editStatus.value,expiresAt:editExpiry.value||null,notes:editNotes.value,components})});await api('/api/admin/licenses/'+encodeURIComponent(l.id)+'/link-user',{method:'POST',body:JSON.stringify({userId:editUser.value||null})});await loadAll();await openLicence(l.id)};rotateLicence.onclick=async()=>{if(!confirm('Rotate key and clear installation locks?'))return;const r=await api('/api/admin/licenses/'+encodeURIComponent(l.id)+'/rotate',{method:'POST',body:'{}'});manageKey.innerHTML='<div class="key"><b>New key</b><br>'+esc(r.licenceKey)+'</div>';await loadAll()};unlockLicence.onclick=async()=>{await api('/api/admin/licenses/'+encodeURIComponent(l.id)+'/unlock',{method:'POST',body:'{}'});await openLicence(l.id)};deleteLicence.onclick=async()=>{const typed=prompt('Type the licence label exactly to permanently delete it:\\n\\n'+l.label);if(typed!==l.label)return;await api('/api/admin/licenses/'+encodeURIComponent(l.id),{method:'DELETE'});licenceEditor.classList.add('hidden');state.detail=null;await loadAll()};editProducts.onclick=async e=>{const b=e.target.closest('[data-unlock-component]');if(!b)return;e.preventDefault();await api('/api/admin/licenses/'+encodeURIComponent(l.id)+'/unlock',{method:'POST',body:JSON.stringify({component:b.dataset.unlockComponent})});await openLicence(l.id)}}authForm.onsubmit=async e=>{e.preventDefault();authError.textContent='';try{const s=await api('/api/admin/setup-status');await api(s.needsSetup?'/api/admin/setup':'/api/admin/login',{method:'POST',body:JSON.stringify({username:adminUser.value,pin:adminPin.value,password:adminPassword.value})});showApp();await loadAll()}catch(x){authError.textContent=x.message}};issueForm.onsubmit=async e=>{e.preventDefault();const components={};document.querySelectorAll('[data-issue-product]').forEach(x=>components[x.dataset.issueProduct]=x.checked);const r=await api('/api/admin/licenses',{method:'POST',body:JSON.stringify({label:issueLabel.value,expiresAt:issueExpiry.value||null,notes:issueNotes.value,userId:issueUser.value||null,components})});issuedKey.innerHTML='<div class="key"><b>Licence key</b><br>'+esc(r.licenceKey)+'</div>';await loadAll()};userForm.onsubmit=async e=>{e.preventDefault();await api('/api/admin/users',{method:'POST',body:JSON.stringify({name:userName.value,email:userEmail.value,pin:userPin.value})});userForm.reset();await loadAll()};userList.onclick=async e=>{const s=e.target.closest('[data-user-status]'),r=e.target.closest('[data-reset-pin]');if(s){await api('/api/admin/users/'+encodeURIComponent(s.dataset.userStatus),{method:'PATCH',body:JSON.stringify({status:s.dataset.next})});await loadAll()}if(r){const pin=prompt('New PIN');if(pin)await api('/api/admin/users/'+encodeURIComponent(r.dataset.resetPin),{method:'PATCH',body:JSON.stringify({pin})})}};licenceList.onclick=e=>{const b=e.target.closest('[data-manage]');if(b)openLicence(b.dataset.manage)};licenceSearch.oninput=renderLicences;validateForm.onsubmit=async e=>{e.preventDefault();validateResult.textContent='Checking...';try{const d=await api('/api/license/validate',{method:'POST',body:JSON.stringify({licenseKey:validateKey.value.trim(),installationId:validateInstall.value.trim(),activate:validateActivate.checked,components:state.products.map(p=>p.id)})});const payload=JSON.parse(atob(d.entitlement.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));validateResult.textContent=JSON.stringify(payload,null,2)}catch(x){validateResult.textContent=x.message}};document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));$('#'+b.dataset.view).classList.remove('hidden')});logout.onclick=async()=>{await api('/api/admin/logout',{method:'POST'});location.reload()};(async()=>{try{await api('/api/admin/session');showApp();await loadAll()}catch{const s=await api('/api/admin/setup-status');authButton.textContent=s.needsSetup?'Create admin':'Sign in'}})();<\/script></body></html>`;
function adminPage() {
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'" } });
}
__name(adminPage, "adminPage");
__name2(adminPage, "adminPage");
var enc = new TextEncoder();
var dec = new TextDecoder();
var b64 = /* @__PURE__ */ __name2((bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))), "b64");
var unb64 = /* @__PURE__ */ __name2((value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0)), "unb64");
var b64url = /* @__PURE__ */ __name2((bytes) => b64(bytes).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"), "b64url");
async function sha(value) {
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(String(value))));
}
__name(sha, "sha");
__name2(sha, "sha");
async function aesKey(env) {
  const secret = String(env.KEY_ESCROW_SECRET || env.ADMIN_API_TOKEN || "");
  if (!secret) throw new Error("Key escrow secret is not configured");
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(secret)), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
__name(aesKey, "aesKey");
__name2(aesKey, "aesKey");
async function encryptKey(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(value));
  return { cipher: b64(data), iv: b64(iv) };
}
__name(encryptKey, "encryptKey");
__name2(encryptKey, "encryptKey");
async function decryptKey(cipher, iv, env) {
  const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(env), unb64(cipher));
  return dec.decode(data);
}
__name(decryptKey, "decryptKey");
__name2(decryptKey, "decryptKey");
function newLicenceKey() {
  return `OFS-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase().match(/.{1,4}/g).join("-")}`;
}
__name(newLicenceKey, "newLicenceKey");
__name2(newLicenceKey, "newLicenceKey");
async function sign(value, env) {
  const secret = String(env.ADMIN_SESSION_SECRET || env.ADMIN_API_TOKEN || "");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}
__name(sign, "sign");
__name2(sign, "sign");
async function makeSession(user, env) {
  const body = b64url(enc.encode(JSON.stringify({ id: user.id, email: user.email, exp: Math.floor(Date.now() / 1e3) + 3600 })));
  return `${body}.${await sign(body, env)}`;
}
__name(makeSession, "makeSession");
__name2(makeSession, "makeSession");
async function sessionUser(request, env) {
  const raw = (request.headers.get("cookie") || "").split(";").map((x) => x.trim()).find((x) => x.startsWith("ofs_user="))?.slice(9);
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig || await sign(body, env) !== sig) return null;
  try {
    const payload = JSON.parse(dec.decode(Uint8Array.from(atob(body.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
    if (payload.exp <= Math.floor(Date.now() / 1e3)) return null;
    return env.DB.prepare("SELECT id,name,email,status FROM licence_users WHERE id=? LIMIT 1").bind(payload.id).first();
  } catch {
    return null;
  }
}
__name(sessionUser, "sessionUser");
__name2(sessionUser, "sessionUser");
async function linked(env, userId) {
  const rows = await env.DB.prepare(`SELECT l.id,l.label,l.status,l.expires_at,l.key_cipher,l.key_iv,GROUP_CONCAT(CASE WHEN c.enabled=1 THEN c.component END) components,COALESCE(SUM(CASE WHEN c.installation_id IS NOT NULL THEN 1 ELSE 0 END),0) locked FROM licences l LEFT JOIN licence_components c ON c.licence_id=l.id WHERE l.user_id=? GROUP BY l.id ORDER BY l.created_at DESC`).bind(userId).all();
  return rows.results || [];
}
__name(linked, "linked");
__name2(linked, "linked");
async function userApi(request, env, json2, nowIso2) {
  const url = new URL(request.url), p = url.pathname;
  if (p === "/api/user/login" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const email = String(b.email || "").trim().toLowerCase(), pin = String(b.pin || "");
    const user2 = await env.DB.prepare("SELECT * FROM licence_users WHERE email=? LIMIT 1").bind(email).first();
    if (!user2 || user2.status !== "active" || user2.pin_hash !== await sha(`${email}|${pin}`)) return json2({ error: "Invalid email or PIN" }, 401);
    const token = await makeSession(user2, env);
    return json2({ ok: true }, 200, { "set-cookie": `ofs_user=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600` });
  }
  if (p === "/api/user/logout" && request.method === "POST") return json2({ ok: true }, 200, { "set-cookie": "ofs_user=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
  const user = await sessionUser(request, env);
  if (!user) return json2({ error: "Unauthorized" }, 401);
  if (p === "/api/user/session" && request.method === "GET") return json2({ user, licences: await linked(env, user.id) });
  const m = p.match(/^\/api\/user\/licenses\/([^/]+)\/(retrieve|rotate|unlock)$/);
  if (m && request.method === "POST") {
    const id = decodeURIComponent(m[1]), action = m[2];
    const licence = await env.DB.prepare("SELECT * FROM licences WHERE id=? AND user_id=? LIMIT 1").bind(id, user.id).first();
    if (!licence) return json2({ error: "Licence not found" }, 404);
    if (action === "retrieve") {
      if (!licence.key_cipher || !licence.key_iv) return json2({ error: "This key predates secure escrow. Rotate it to create a retrievable key." }, 409);
      return json2({ licenceKey: await decryptKey(licence.key_cipher, licence.key_iv, env) });
    }
    if (action === "rotate") {
      const key = newLicenceKey(), sealed = await encryptKey(key, env), stamp = nowIso2();
      await env.DB.prepare("UPDATE licences SET key_hash=?,key_cipher=?,key_iv=?,updated_at=? WHERE id=?").bind(await sha(key), sealed.cipher, sealed.iv, stamp, id).run();
      await env.DB.prepare("UPDATE licence_components SET installation_id=NULL,locked_at=NULL WHERE licence_id=?").bind(id).run();
      await env.DB.prepare("INSERT INTO audit_log (id,licence_id,action,detail,created_at) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(), id, "user_rotate_key", JSON.stringify({ userId: user.id }), stamp).run();
      await env.DB.prepare("UPDATE system_state SET value=CAST(value AS INTEGER)+1,updated_at=? WHERE key='revision'").bind(stamp).run();
      return json2({ licenceKey: key, warning: "Copy this key now. It is also stored in encrypted escrow." });
    }
    if (action === "unlock") {
      const b = await request.json().catch(() => ({}));
      const component = String(b.component || "");
      if (component) await env.DB.prepare("UPDATE licence_components SET installation_id=NULL,locked_at=NULL WHERE licence_id=? AND component=?").bind(id, component).run();
      else await env.DB.prepare("UPDATE licence_components SET installation_id=NULL,locked_at=NULL WHERE licence_id=?").bind(id).run();
      const stamp = nowIso2();
      await env.DB.prepare("INSERT INTO audit_log (id,licence_id,action,detail,created_at) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(), id, "user_unlock", JSON.stringify({ userId: user.id, component: component || "all" }), stamp).run();
      await env.DB.prepare("UPDATE system_state SET value=CAST(value AS INTEGER)+1,updated_at=? WHERE key='revision'").bind(stamp).run();
      return json2({ ok: true });
    }
  }
  return json2({ error: "Not found" }, 404);
}
__name(userApi, "userApi");
__name2(userApi, "userApi");
async function createLicenceUser(env, { name, email, pin }, nowIso2) {
  const cleanEmail = String(email || "").trim().toLowerCase(), cleanPin = String(pin || "");
  if (!name || !cleanEmail || cleanPin.length < 4) throw new Error("Name, email and a PIN of at least 4 digits are required");
  const id = crypto.randomUUID(), stamp = nowIso2();
  await env.DB.prepare("INSERT INTO licence_users (id,name,email,pin_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id, String(name).trim(), cleanEmail, await sha(`${cleanEmail}|${cleanPin}`), "active", stamp, stamp).run();
  return { id, name: String(name).trim(), email: cleanEmail, status: "active" };
}
__name(createLicenceUser, "createLicenceUser");
__name2(createLicenceUser, "createLicenceUser");
async function rotateLicenceKey(env, id, nowIso2) {
  const key = newLicenceKey(), sealed = await encryptKey(key, env), stamp = nowIso2();
  await env.DB.prepare("UPDATE licences SET key_hash=?,key_cipher=?,key_iv=?,updated_at=? WHERE id=?").bind(await sha(key), sealed.cipher, sealed.iv, stamp, id).run();
  await env.DB.prepare("UPDATE licence_components SET installation_id=NULL,locked_at=NULL WHERE licence_id=?").bind(id).run();
  return key;
}
__name(rotateLicenceKey, "rotateLicenceKey");
__name2(rotateLicenceKey, "rotateLicenceKey");
var PRODUCT_META = { orbitfs_panel: { name: "OrbitFS Base", shortName: "Base", description: "Core OrbitFS base system, including the management panel and Workspaces." }, orbitfs_mcp: { name: "OrbitFS MCP", shortName: "MCP", description: "Workspace context, startup, projects, presets, and connected clients." }, orbitfs_sorter: { name: "OrbitFS Sorter", shortName: "Sorter", description: "Automated file analysis, queueing, and sorting." }, orbitfs_studio: { name: "OrbitFS Studio", shortName: "Studio", description: "OrbitFS Studio component entitlement." } };
var enc2 = new TextEncoder();
var b642 = /* @__PURE__ */ __name2((b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"), "b64");
var unb642 = /* @__PURE__ */ __name2((s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)), "unb64");
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", enc2.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b642(await crypto.subtle.sign("HMAC", key, enc2.encode(value)));
}
__name(hmac, "hmac");
__name2(hmac, "hmac");
async function makeSession2(env, username) {
  const exp = Math.floor(Date.now() / 1e3) + 28800;
  const body = b642(enc2.encode(JSON.stringify({ u: username, exp })));
  return `${body}.${await hmac(body, env.ADMIN_SESSION_SECRET || env.ADMIN_API_TOKEN)}`;
}
__name(makeSession2, "makeSession2");
__name2(makeSession2, "makeSession");
async function validSession(request, env) {
  const raw = (request.headers.get("cookie") || "").split(";").map((x) => x.trim()).find((x) => x.startsWith("ofs_admin="))?.slice(10);
  if (!raw || !(env.ADMIN_SESSION_SECRET || env.ADMIN_API_TOKEN)) return false;
  const [body, sig] = raw.split(".");
  if (!body || !sig || await hmac(body, env.ADMIN_SESSION_SECRET || env.ADMIN_API_TOKEN) !== sig) return false;
  try {
    return JSON.parse(new TextDecoder().decode(unb642(body))).exp > Math.floor(Date.now() / 1e3);
  } catch {
    return false;
  }
}
__name(validSession, "validSession");
__name2(validSession, "validSession");
async function adminApi(request, env, json2, sha2562, nowIso2, COMPONENTS2) {
  const u = new URL(request.url), p = u.pathname;
  if (p === "/api/admin/setup-status" && request.method === "GET") {
    const row = await env.DB.prepare("SELECT COUNT(*) count FROM admin_users").first();
    return json2({ needsSetup: Number(row?.count || 0) === 0 });
  }
  if (p === "/api/admin/setup" && request.method === "POST") {
    const row = await env.DB.prepare("SELECT COUNT(*) count FROM admin_users").first();
    if (Number(row?.count || 0) > 0) return json2({ error: "Setup already completed" }, 409);
    const b = await request.json().catch(() => ({}));
    const username = String(b.username || "").trim(), pin = String(b.pin || ""), password = String(b.password || "");
    if (!username || pin.length < 4 || password.length < 8) return json2({ error: "Username, PIN and password are required. Password must be at least 8 characters." }, 400);
    const stamp = nowIso2();
    await env.DB.prepare("INSERT INTO admin_users (id,username,credential_hash,created_at,updated_at) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(), username, await sha2562(`${username}|${pin}|${password}`), stamp, stamp).run();
    const token = await makeSession2(env, username);
    return json2({ ok: true }, 201, { "set-cookie": `ofs_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800` });
  }
  if (p === "/api/admin/login" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const username = String(b.username || "").trim();
    const row = await env.DB.prepare("SELECT * FROM admin_users WHERE username=? LIMIT 1").bind(username).first();
    const hash = await sha2562(`${username}|${String(b.pin || "")}|${String(b.password || "")}`);
    if (!row || row.credential_hash !== hash) return json2({ error: "Invalid credentials" }, 401);
    const token = await makeSession2(env, row.username);
    return json2({ ok: true }, 200, { "set-cookie": `ofs_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800` });
  }
  if (p === "/api/admin/logout" && request.method === "POST") return json2({ ok: true }, 200, { "set-cookie": "ofs_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
  if (!await validSession(request, env)) return json2({ error: "Unauthorized" }, 401);
  if (p === "/api/admin/session" && request.method === "GET") return json2({ ok: true });
  if (p === "/api/admin/products" && request.method === "GET") return json2({ products: COMPONENTS2.map((id) => ({ id, ...PRODUCT_META[id] })) });
  if (p === "/api/admin/licenses" && request.method === "GET") {
    const rows = await env.DB.prepare(`SELECT l.*,COALESCE(SUM(CASE WHEN c.installation_id IS NOT NULL THEN 1 ELSE 0 END),0) locked,GROUP_CONCAT(CASE WHEN c.enabled=1 THEN c.component END) components FROM licences l LEFT JOIN licence_components c ON c.licence_id=l.id GROUP BY l.id ORDER BY l.created_at DESC`).all();
    return json2({ licences: rows.results || [] });
  }
  if (p === "/api/admin/licenses" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const label = String(b.label || "").trim();
    if (!label) return json2({ error: "Label is required" }, 400);
    const key = newLicenceKey(), id = crypto.randomUUID(), stamp = nowIso2(), sealed = await encryptKey(key, env);
    await env.DB.prepare("INSERT INTO licences (id,label,key_hash,status,expires_at,notes,created_at,updated_at,key_cipher,key_iv,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id, label, await sha2562(key), "active", b.expiresAt || null, b.notes || null, stamp, stamp, sealed.cipher, sealed.iv, b.userId || null).run();
    for (const c of COMPONENTS2) await env.DB.prepare("INSERT INTO licence_components (licence_id,component,enabled) VALUES (?,?,?)").bind(id, c, b.components?.[c] === true ? 1 : 0).run();
    await env.DB.prepare("UPDATE system_state SET value=CAST(value AS INTEGER)+1,updated_at=? WHERE key='revision'").bind(stamp).run();
    return json2({ id, licenceKey: key, warning: "This key is returned once and cannot be recovered." }, 201);
  }
  if (p === "/api/admin/users" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id,name,email,status,created_at,updated_at FROM licence_users ORDER BY created_at DESC").all();
    return json2({ users: rows.results || [] });
  }
  if (p === "/api/admin/users" && request.method === "POST") {
    try {
      return json2({ user: await createLicenceUser(env, await request.json().catch(() => ({})), nowIso2) }, 201);
    } catch (e) {
      return json2({ error: String(e.message || e) }, 400);
    }
  }
  const um = p.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (um && request.method === "PATCH") {
    const b = await request.json().catch(() => ({}));
    const id = decodeURIComponent(um[1]);
    if (b.status && ["active", "blocked"].includes(b.status)) await env.DB.prepare("UPDATE licence_users SET status=?,updated_at=? WHERE id=?").bind(b.status, nowIso2(), id).run();
    if (b.pin) {
      const row = await env.DB.prepare("SELECT email FROM licence_users WHERE id=?").bind(id).first();
      if (!row) return json2({ error: "User not found" }, 404);
      await env.DB.prepare("UPDATE licence_users SET pin_hash=?,updated_at=? WHERE id=?").bind(await sha2562(row.email + "|" + String(b.pin)), nowIso2(), id).run();
    }
    return json2({ ok: true });
  }
  const lm = p.match(/^\/api\/admin\/licenses\/([^/]+)\/(link-user|rotate|unlock|detail)$/);
  if (lm) {
    const id = decodeURIComponent(lm[1]), action = lm[2];
    if (action === "detail" && request.method === "GET") {
      const licence = await env.DB.prepare("SELECT l.*,u.name user_name,u.email user_email,u.status user_status FROM licences l LEFT JOIN licence_users u ON u.id=l.user_id WHERE l.id=?").bind(id).first();
      if (!licence) return json2({ error: "Licence not found" }, 404);
      const components = await env.DB.prepare("SELECT component,enabled,installation_id,locked_at FROM licence_components WHERE licence_id=?").bind(id).all();
      const audit = await env.DB.prepare("SELECT action,detail,created_at FROM audit_log WHERE licence_id=? ORDER BY created_at DESC LIMIT 100").bind(id).all();
      return json2({ licence, components: components.results || [], audit: audit.results || [] });
    }
    if (request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      if (action === "link-user") {
        await env.DB.prepare("UPDATE licences SET user_id=?,updated_at=? WHERE id=?").bind(b.userId || null, nowIso2(), id).run();
        return json2({ ok: true });
      }
      if (action === "rotate") {
        return json2({ licenceKey: await rotateLicenceKey(env, id, nowIso2), warning: "Copy now. The key is also stored in encrypted escrow." });
      }
      if (action === "unlock") {
        if (b.component) await env.DB.prepare("UPDATE licence_components SET installation_id=NULL,locked_at=NULL WHERE licence_id=? AND component=?").bind(id, b.component).run();
        else await env.DB.prepare("UPDATE licence_components SET installation_id=NULL,locked_at=NULL WHERE licence_id=?").bind(id).run();
        return json2({ ok: true });
      }
    }
  }
  const m = p.match(/^\/api\/admin\/licenses\/([^/]+)$/);
  if (m && request.method === "DELETE") {
    const id = decodeURIComponent(m[1]);
    const licence = await env.DB.prepare("SELECT id,label FROM licences WHERE id=? LIMIT 1").bind(id).first();
    if (!licence) return json2({ error: "Licence not found" }, 404);
    await env.DB.prepare("DELETE FROM audit_log WHERE licence_id=?").bind(id).run();
    await env.DB.prepare("DELETE FROM licences WHERE id=?").bind(id).run();
    await env.DB.prepare("UPDATE system_state SET value=CAST(value AS INTEGER)+1,updated_at=? WHERE key='revision'").bind(nowIso2()).run();
    return json2({ ok: true, deleted: { id: licence.id, label: licence.label } });
  }
  if (m && request.method === "PATCH") {
    const b = await request.json().catch(() => ({}));
    const id = decodeURIComponent(m[1]);
    if (b.status && ["active", "blocked"].includes(b.status)) await env.DB.prepare("UPDATE licences SET status=?,updated_at=? WHERE id=?").bind(b.status, nowIso2(), id).run();
    if (Object.prototype.hasOwnProperty.call(b, "expiresAt")) await env.DB.prepare("UPDATE licences SET expires_at=?,updated_at=? WHERE id=?").bind(b.expiresAt || null, nowIso2(), id).run();
    if (Object.prototype.hasOwnProperty.call(b, "notes")) await env.DB.prepare("UPDATE licences SET notes=?,updated_at=? WHERE id=?").bind(b.notes || null, nowIso2(), id).run();
    if (b.components) for (const c of COMPONENTS2) await env.DB.prepare("UPDATE licence_components SET enabled=? WHERE licence_id=? AND component=?").bind(b.components[c] === true ? 1 : 0, id, c).run();
    await env.DB.prepare("UPDATE system_state SET value=CAST(value AS INTEGER)+1,updated_at=? WHERE key='revision'").bind(nowIso2()).run();
    return json2({ ok: true });
  }
  return json2({ error: "Not found" }, 404);
}
__name(adminApi, "adminApi");
__name2(adminApi, "adminApi");
var html2 = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OrbitFS Licence Portal</title><style>:root{color-scheme:dark;font-family:system-ui;background:#0a0f18;color:#eef4ff}*{box-sizing:border-box}body{margin:0}main{max-width:760px;margin:auto;padding:24px}.card{border:1px solid #30415d;background:#111a29;border-radius:10px;padding:16px;margin-bottom:14px}.grid{display:grid;gap:10px}input,button{width:100%;padding:11px;border-radius:8px;border:1px solid #3a4d6d;background:#0a1220;color:#fff}button{cursor:pointer;background:#246ed8;font-weight:700}.secondary{background:#17243a}.danger{background:#58232b}.hidden{display:none}.muted{color:#9babc0;font-size:13px}.key{word-break:break-all;border:1px solid #367a5b;background:#10271f;padding:12px;border-radius:8px}.row{display:flex;gap:8px;flex-wrap:wrap}.row button{width:auto}@media(max-width:560px){main{padding:14px}}</style></head><body><main><h1>OrbitFS Licence Portal</h1><p class="muted">Use the email and PIN linked to your licence.</p><section id="login" class="card"><form id="loginForm" class="grid"><input id="email" type="email" placeholder="Email" required><input id="pin" type="password" inputmode="numeric" placeholder="PIN" required><button>Sign in</button><p id="error" class="muted"></p></form></section><section id="account" class="hidden"><div class="card"><div id="user"></div><button id="logout" class="secondary">Sign out</button></div><div id="licences"></div></section></main><script>const $=s=>document.querySelector(s);const login=$('#login'),loginForm=$('#loginForm'),email=$('#email'),pin=$('#pin'),error=$('#error'),account=$('#account'),user=$('#user'),logout=$('#logout'),licences=$('#licences');async function api(p,o={}){const r=await fetch(p,{credentials:'include',headers:{'content-type':'application/json'},...o});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'Request failed');return b}function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}async function load(){const d=await api('/api/user/session');login.classList.add('hidden');account.classList.remove('hidden');user.innerHTML='<b>'+esc(d.user.name)+'</b><div class="muted">'+esc(d.user.email)+'</div>';licences.innerHTML=d.licences.length?d.licences.map(x=>'<div class="card"><h3>'+esc(x.label)+'</h3><p>Status: <b>'+esc(x.status)+'</b></p><p>Products: '+esc(x.components||'None')+'</p><p>Expiry: '+esc(x.expires_at||'No expiry')+'</p><p>Locks: '+Number(x.locked)+'</p><div class="row"><button data-action="retrieve" data-id="'+esc(x.id)+'">Retrieve key</button><button class="secondary" data-action="unlock" data-id="'+esc(x.id)+'">Unlock installations</button><button class="danger" data-action="rotate" data-id="'+esc(x.id)+'">Rotate key</button></div><div id="key-'+esc(x.id)+'"></div></div>').join(''):'<div class="card">No linked licences.</div>'}loginForm.onsubmit=async e=>{e.preventDefault();error.textContent='';try{await api('/api/user/login',{method:'POST',body:JSON.stringify({email:email.value.trim(),pin:pin.value})});await load()}catch(x){error.textContent=x.message}};licences.onclick=async e=>{const b=e.target.closest('button[data-action]');if(!b)return;if(b.dataset.action==='rotate'&&!confirm('Rotate this key? Existing installations will stop working until the new key is entered.'))return;try{const d=await api('/api/user/licenses/'+encodeURIComponent(b.dataset.id)+'/'+b.dataset.action,{method:'POST',body:'{}'});if(d.licenceKey)$('#key-'+b.dataset.id).innerHTML='<div class="key"><b>Licence key</b><br>'+esc(d.licenceKey)+'</div>';else await load()}catch(x){alert(x.message)}};logout.onclick=async()=>{await api('/api/user/logout',{method:'POST'});location.reload()};load().catch(()=>{});<\/script></body></html>`;
function portalPage() {
  return new Response(html2, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'" } });
}
__name(portalPage, "portalPage");
__name2(portalPage, "portalPage");
var COMPONENTS = [
  "orbitfs_panel",
  "orbitfs_mcp",
  "orbitfs_sorter",
  "orbitfs_studio"
];
var json = /* @__PURE__ */ __name2((body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  }
}), "json");
var nowIso = /* @__PURE__ */ __name2(() => (/* @__PURE__ */ new Date()).toISOString(), "nowIso");
var unixNow = /* @__PURE__ */ __name2(() => Math.floor(Date.now() / 1e3), "unixNow");
var base64url = /* @__PURE__ */ __name2((bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"), "base64url");
function cors(request) {
  const origin = request.headers.get("origin") || "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "vary": "origin"
  };
}
__name(cors, "cors");
__name2(cors, "cors");
async function sha256(value) {
  const data = new TextEncoder().encode(String(value));
  return base64url(await crypto.subtle.digest("SHA-256", data));
}
__name(sha256, "sha256");
__name2(sha256, "sha256");
function pemToBytes(pem) {
  const normalized = String(pem || "").replace(/\\n/g, "\n");
  const clean = normalized.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));
}
__name(pemToBytes, "pemToBytes");
__name2(pemToBytes, "pemToBytes");
async function signingKey(env) {
  const encoded = String(env.ENTITLEMENT_PRIVATE_KEY_B64 || "").trim();
  const pem = encoded ? atob(encoded) : String(env.ENTITLEMENT_PRIVATE_KEY || "");
  if (!pem) throw new Error("Entitlement private key is not configured");
  return crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}
__name(signingKey, "signingKey");
__name2(signingKey, "signingKey");
async function signEntitlement(payload, env) {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const input = `${header}.${body}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await signingKey(env),
    new TextEncoder().encode(input)
  );
  return `${input}.${base64url(signature)}`;
}
__name(signEntitlement, "signEntitlement");
__name2(signEntitlement, "signEntitlement");
async function loadLicence(env, licenceKey) {
  const keyHash = await sha256(String(licenceKey || "").trim());
  const licence = await env.DB.prepare(
    "SELECT * FROM licences WHERE key_hash = ? LIMIT 1"
  ).bind(keyHash).first();
  if (!licence) return null;
  const componentRows = await env.DB.prepare(
    "SELECT component, enabled, installation_id FROM licence_components WHERE licence_id = ?"
  ).bind(licence.id).all();
  return { licence, componentRows: componentRows.results || [] };
}
__name(loadLicence, "loadLicence");
__name2(loadLicence, "loadLicence");
function componentResult(row, installationId, licenceState) {
  if (!row || Number(row.enabled) !== 1) {
    return { state: "blocked", allowed: false, lockedToThisInstallation: false, reason: "not_included" };
  }
  if (licenceState !== "active") {
    return { state: licenceState, allowed: false, lockedToThisInstallation: false, reason: licenceState };
  }
  if (!row.installation_id) {
    return { state: "active", allowed: true, lockedToThisInstallation: false, reason: "activation_required" };
  }
  const same = row.installation_id === installationId;
  return {
    state: same ? "locked" : "blocked",
    allowed: same,
    lockedToThisInstallation: same,
    reason: same ? null : "locked_to_another_installation"
  };
}
__name(componentResult, "componentResult");
__name2(componentResult, "componentResult");
async function validateLicence(request, env) {
  const body = await request.json().catch(() => ({}));
  const licenceKey = String(body.licenseKey || "").trim();
  const installationId = String(body.installationId || "").trim();
  const requested = Array.isArray(body.components) ? body.components.filter((c) => COMPONENTS.includes(c)) : COMPONENTS;
  if (!licenceKey || !installationId) return json({ error: "Licence key and installation ID are required", code: "BAD_REQUEST" }, 400, cors(request));
  const loaded = await loadLicence(env, licenceKey);
  if (!loaded) return json({ error: "Licence not found", code: "LICENSE_NOT_FOUND" }, 404, cors(request));
  const { licence, componentRows } = loaded;
  const expired = licence.expires_at && Date.parse(licence.expires_at) <= Date.now();
  const licenceState = expired ? "expired" : licence.status;
  if (body.activate === true && licenceState === "active") {
    for (const component of requested) {
      const row = componentRows.find((item) => item.component === component);
      if (row && Number(row.enabled) === 1 && !row.installation_id) {
        await env.DB.prepare(
          "UPDATE licence_components SET installation_id = ?, locked_at = ? WHERE licence_id = ? AND component = ?"
        ).bind(installationId, nowIso(), licence.id, component).run();
        row.installation_id = installationId;
      }
    }
  }
  const components = Object.fromEntries(COMPONENTS.map((component) => [
    component,
    componentResult(componentRows.find((item) => item.component === component), installationId, licenceState)
  ]));
  const issuedAt = unixNow();
  const ttl = Number(env.ENTITLEMENT_TTL_SECONDS || 10800);
  const grace = Number(env.ENTITLEMENT_GRACE_SECONDS || 604800);
  const payload = {
    iss: env.ENTITLEMENT_ISSUER || "license.incendiarynetworks.cc",
    aud: env.ENTITLEMENT_AUDIENCE || "orbitfs-runtime",
    iat: issuedAt,
    exp: issuedAt + ttl,
    graceUntil: issuedAt + ttl + grace,
    valid: licenceState === "active",
    reason: licenceState === "active" ? null : licenceState,
    licenceId: licence.id,
    installationId,
    components
  };
  const entitlement = await signEntitlement(payload, env);
  await env.DB.prepare(
    "INSERT INTO audit_log (id, licence_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), licence.id, body.activate === true ? "validate_activate" : "validate", JSON.stringify({ installationId, requested }), nowIso()).run();
  return json({ entitlement }, 200, cors(request));
}
__name(validateLicence, "validateLicence");
__name2(validateLicence, "validateLicence");
async function revision(request, env) {
  const row = await env.DB.prepare("SELECT value FROM system_state WHERE key = 'revision'").first();
  return json({ revision: row?.value || "1" }, 200, cors(request));
}
__name(revision, "revision");
__name2(revision, "revision");
async function health(request) {
  return json({ ok: true, service: "orbitfs-license-web", time: nowIso() }, 200, cors(request));
}
__name(health, "health");
__name2(health, "health");
function requireAdmin(request, env) {
  const token = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const expected = String(env.ADMIN_API_TOKEN || "").trim().replace(/^"|"$/g, "");
  return Boolean(expected && token === expected);
}
__name(requireAdmin, "requireAdmin");
__name2(requireAdmin, "requireAdmin");
async function createLicence(request, env) {
  if (!requireAdmin(request, env)) return json({ error: "Unauthorized" }, 401, cors(request));
  const body = await request.json().catch(() => ({}));
  const label = String(body.label || "").trim();
  if (!label) return json({ error: "Label is required" }, 400, cors(request));
  const licenceKey = `OFS-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase().match(/.{1,4}/g).join("-")}`;
  const id = crypto.randomUUID();
  const stamp = nowIso();
  await env.DB.prepare(
    "INSERT INTO licences (id, label, key_hash, status, expires_at, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, label, await sha256(licenceKey), "active", body.expiresAt || null, body.notes || null, stamp, stamp).run();
  for (const component of COMPONENTS) {
    const enabled = body.components?.[component] === true ? 1 : 0;
    await env.DB.prepare(
      "INSERT INTO licence_components (licence_id, component, enabled) VALUES (?, ?, ?)"
    ).bind(id, component, enabled).run();
  }
  await env.DB.prepare("UPDATE system_state SET value = CAST(value AS INTEGER) + 1, updated_at = ? WHERE key = 'revision'").bind(stamp).run();
  return json({ id, licenceKey, warning: "This key is returned once and is not stored in recoverable form." }, 201, cors(request));
}
__name(createLicence, "createLicence");
__name2(createLicence, "createLicence");
function requireBilling(request, env) {
  const token = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const expected = String(env.BILLING_API_TOKEN || "").trim().replace(/^"|"$/g, "");
  return Boolean(expected && token === expected);
}
__name(requireBilling, "requireBilling");
__name2(requireBilling, "requireBilling");
async function billingApi(request, env) {
  if (!requireBilling(request, env)) return json({ error: "Unauthorized" }, 401, cors(request));
  const u = new URL(request.url), p = u.pathname;
  if (p === "/api/integration/v1/users/upsert" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const email = String(b.email || "").trim().toLowerCase();
    const name = String(b.name || "").trim();
    if (!email || !name) return json({ error: "Name and email are required" }, 400, cors(request));
    let user = await env.DB.prepare("SELECT id,name,email,status FROM licence_users WHERE email=? LIMIT 1").bind(email).first();
    if (user) {
      if (user.name !== name) await env.DB.prepare("UPDATE licence_users SET name=?,updated_at=? WHERE id=?").bind(name, nowIso(), user.id).run();
      user = await env.DB.prepare("SELECT id,name,email,status FROM licence_users WHERE id=? LIMIT 1").bind(user.id).first();
      return json({ user, created: false }, 200, cors(request));
    }
    const id = crypto.randomUUID(), stamp = nowIso(), seed = crypto.randomUUID() + crypto.randomUUID();
    await env.DB.prepare("INSERT INTO licence_users (id,name,email,pin_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id, name, email, await sha256(email + "|" + seed), "active", stamp, stamp).run();
    user = { id, name, email, status: "active" };
    return json({ user, created: true }, 201, cors(request));
  }
  if (p === "/api/integration/v1/users/by-email" && request.method === "GET") {
    const email = String(u.searchParams.get("email") || "").trim().toLowerCase();
    if (!email) return json({ error: "Email is required" }, 400, cors(request));
    const user = await env.DB.prepare("SELECT id,name,email,status FROM licence_users WHERE email=? LIMIT 1").bind(email).first();
    if (!user) return json({ user: null, licences: [] }, 200, cors(request));
    const lr = await env.DB.prepare("SELECT id,label,status,expires_at,notes,created_at,updated_at FROM licences WHERE user_id=? ORDER BY created_at DESC").bind(user.id).all();
    const licences = [];
    for (const licence of lr.results || []) {
      const cr = await env.DB.prepare("SELECT component,enabled,installation_id,locked_at FROM licence_components WHERE licence_id=? ORDER BY component").bind(licence.id).all();
      licences.push({ ...licence, components: cr.results || [] });
    }
    return json({ user, licences }, 200, cors(request));
  }
  const userById = p.match(/^\/api\/integration\/v1\/users\/([^/]+)$/);
  if (userById && request.method === "GET") {
    const id = decodeURIComponent(userById[1]);
    const user = await env.DB.prepare("SELECT id,name,email,status FROM licence_users WHERE id=? LIMIT 1").bind(id).first();
    if (!user) return json({ error: "Licence user not found" }, 404, cors(request));
    const lr = await env.DB.prepare("SELECT id,label,status,expires_at,notes,created_at,updated_at FROM licences WHERE user_id=? ORDER BY created_at DESC").bind(id).all();
    const licences = [];
    for (const licence of lr.results || []) {
      const cr = await env.DB.prepare("SELECT component,enabled,installation_id,locked_at FROM licence_components WHERE licence_id=? ORDER BY component").bind(licence.id).all();
      licences.push({ ...licence, components: cr.results || [] });
    }
    return json({ user, licences }, 200, cors(request));
  }
  if (p === "/api/integration/v1/licenses" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const label = String(b.label || "").trim();
    if (!label) return json({ error: "Label is required" }, 400, cors(request));
    const id = crypto.randomUUID(), key = newLicenceKey(), sealed = await encryptKey(key, env), stamp = nowIso();
    await env.DB.prepare("INSERT INTO licences (id,label,key_hash,status,expires_at,notes,created_at,updated_at,key_cipher,key_iv,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id, label, await sha256(key), "active", b.expiresAt || null, b.notes || null, stamp, stamp, sealed.cipher, sealed.iv, b.userId || null).run();
    const enabled = { orbitfs_panel: true, orbitfs_mcp: b.components?.orbitfs_mcp === true, orbitfs_workspaces: b.components?.orbitfs_workspaces === true, orbitfs_sorter: false };
    for (const component of COMPONENTS) await env.DB.prepare("INSERT INTO licence_components (licence_id,component,enabled) VALUES (?,?,?)").bind(id, component, enabled[component] ? 1 : 0).run();
    await env.DB.prepare("UPDATE system_state SET value=CAST(value AS INTEGER)+1,updated_at=? WHERE key='revision'").bind(stamp).run();
    return json({ id, licenceKey: key, components: enabled }, 201, cors(request));
  }
  const m = p.match(/^\/api\/integration\/v1\/licenses\/([^/]+)$/);
  if (m && request.method === "GET") {
    const id = decodeURIComponent(m[1]);
    const licence = await env.DB.prepare("SELECT id,label,status,expires_at,notes,user_id,created_at,updated_at FROM licences WHERE id=? LIMIT 1").bind(id).first();
    if (!licence) return json({ error: "Licence not found" }, 404, cors(request));
    const rows = await env.DB.prepare("SELECT component,enabled,installation_id,locked_at FROM licence_components WHERE licence_id=?").bind(id).all();
    return json({ licence, components: rows.results || [] }, 200, cors(request));
  }
  if (m && request.method === "DELETE") {
    const id = decodeURIComponent(m[1]), stamp = nowIso();
    const licence = await env.DB.prepare("SELECT id,label FROM licences WHERE id=? LIMIT 1").bind(id).first();
    if (!licence) return json({ error: "Licence not found" }, 404, cors(request));
    await env.DB.prepare("DELETE FROM audit_log WHERE licence_id=?").bind(id).run();
    await env.DB.prepare("DELETE FROM licences WHERE id=?").bind(id).run();
    await env.DB.prepare("UPDATE system_state SET value=CAST(value AS INTEGER)+1,updated_at=? WHERE key='revision'").bind(stamp).run();
    return json({ ok: true, deleted: { id: licence.id, label: licence.label } }, 200, cors(request));
  }
  if (m && request.method === "PATCH") {
    const id = decodeURIComponent(m[1]), b = await request.json().catch(() => ({})), stamp = nowIso();
    const licence = await env.DB.prepare("SELECT id FROM licences WHERE id=? LIMIT 1").bind(id).first();
    if (!licence) return json({ error: "Licence not found" }, 404, cors(request));
    if (b.components && Object.prototype.hasOwnProperty.call(b.components, "orbitfs_panel") && b.components.orbitfs_panel !== true) return json({ error: "OrbitFS Base System requires orbitfs_panel" }, 409, cors(request));
    if (b.status && ["active", "blocked"].includes(b.status)) await env.DB.prepare("UPDATE licences SET status=?,updated_at=? WHERE id=?").bind(b.status, stamp, id).run();
    if (Object.prototype.hasOwnProperty.call(b, "expiresAt")) await env.DB.prepare("UPDATE licences SET expires_at=?,updated_at=? WHERE id=?").bind(b.expiresAt || null, stamp, id).run();
    if (Object.prototype.hasOwnProperty.call(b, "notes")) await env.DB.prepare("UPDATE licences SET notes=?,updated_at=? WHERE id=?").bind(b.notes || null, stamp, id).run();
    if (Object.prototype.hasOwnProperty.call(b, "userId")) {
      const userId = String(b.userId || "").trim();
      if (!userId) return json({ error: "userId cannot be empty" }, 400, cors(request));
      const owner = await env.DB.prepare("SELECT id FROM licence_users WHERE id=? LIMIT 1").bind(userId).first();
      if (!owner) return json({ error: "Licence user not found" }, 404, cors(request));
      await env.DB.prepare("UPDATE licences SET user_id=?,updated_at=? WHERE id=?").bind(userId, stamp, id).run();
    }
    if (b.components) for (const [component, value] of Object.entries(b.components)) {
      if (component === "orbitfs_panel") continue;
      if (!/^orbitfs_[a-z0-9_]+$/.test(component)) return json({ error: "Invalid component" }, 400, cors(request));
      const registered = await env.DB.prepare("SELECT component FROM licence_components WHERE licence_id=? AND component=? LIMIT 1").bind(id, component).first();
      if (!registered) return json({ error: `Component ${component} is not registered for this licence` }, 409, cors(request));
      await env.DB.prepare("UPDATE licence_components SET enabled=? WHERE licence_id=? AND component=?").bind(value === true ? 1 : 0, id, component).run();
    }
    await env.DB.prepare("UPDATE licence_components SET enabled=1 WHERE licence_id=? AND component='orbitfs_panel'").bind(id).run();
    await env.DB.prepare("UPDATE system_state SET value=CAST(value AS INTEGER)+1,updated_at=? WHERE key='revision'").bind(stamp).run();
    return json({ ok: true }, 200, cors(request));
  }
  const action = p.match(/^\/api\/integration\/v1\/licenses\/([^/]+)\/(retrieve|rotate|unlock)$/);
  if (action && request.method === "POST") {
    const id = decodeURIComponent(action[1]), name = action[2];
    const licence = await env.DB.prepare("SELECT * FROM licences WHERE id=? LIMIT 1").bind(id).first();
    if (!licence) return json({ error: "Licence not found" }, 404, cors(request));
    if (name === "retrieve") {
      if (!licence.key_cipher || !licence.key_iv) return json({ error: "Key cannot be retrieved until it is rotated into secure escrow" }, 409, cors(request));
      return json({ licenceKey: await decryptKey(licence.key_cipher, licence.key_iv, env) }, 200, cors(request));
    }
    if (name === "rotate") {
      const key = await rotateLicenceKey(env, id, nowIso), stamp = nowIso();
      await env.DB.prepare("UPDATE system_state SET value=CAST(value AS INTEGER)+1,updated_at=? WHERE key='revision'").bind(stamp).run();
      return json({ licenceKey: key, warning: "Existing installations must enter the new key." }, 200, cors(request));
    }
    const b = await request.json().catch(() => ({}));
    if (b.component) {
      if (!/^orbitfs_[a-z0-9_]+$/.test(b.component)) return json({ error: "Invalid component" }, 400, cors(request));
      const registered = await env.DB.prepare("SELECT component FROM licence_components WHERE licence_id=? AND component=? LIMIT 1").bind(id, b.component).first();
      if (!registered) return json({ error: "Component is not registered for this licence" }, 409, cors(request));
      await env.DB.prepare("UPDATE licence_components SET installation_id=NULL,locked_at=NULL WHERE licence_id=? AND component=?").bind(id, b.component).run();
    } else await env.DB.prepare("UPDATE licence_components SET installation_id=NULL,locked_at=NULL WHERE licence_id=?").bind(id).run();
    await env.DB.prepare("UPDATE system_state SET value=CAST(value AS INTEGER)+1,updated_at=? WHERE key='revision'").bind(nowIso()).run();
    return json({ ok: true }, 200, cors(request));
  }
  return json({ error: "Not found" }, 404, cors(request));
}
__name(billingApi, "billingApi");
__name2(billingApi, "billingApi");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();
    const apiOnlyHost = hostname === "license.incendiarynetworks.cc";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
    try {
      if (apiOnlyHost && (url.pathname.startsWith("/api/admin/") || url.pathname.startsWith("/api/user/") || url.pathname === "/portal")) return json({ error: "Not found" }, 404, cors(request));
      if (apiOnlyHost && request.method === "GET" && url.pathname === "/") return json({ ok: true, service: "OrbitFS Licence API", validate: "/api/license/validate", revision: "/api/license/revision" }, 200, cors(request));
      if (url.pathname.startsWith("/api/integration/v1/")) return apiOnlyHost ? billingApi(request, env) : json({ error: "Not found" }, 404, cors(request));
      if (url.pathname.startsWith("/api/admin/")) return adminApi(request, env, json, sha256, nowIso, COMPONENTS);
      if (url.pathname.startsWith("/api/user/")) return userApi(request, env, json, nowIso);
      if (request.method === "GET" && url.pathname === "/health") return health(request);
      if (request.method === "GET" && url.pathname === "/api/license/revision") return revision(request, env);
      if (request.method === "POST" && url.pathname === "/api/license/validate") return validateLicence(request, env);
      if (request.method === "POST" && url.pathname === "/api/licenses") return createLicence(request, env);
      if (url.pathname === "/portal") return portalPage();
      if (!url.pathname.startsWith("/api/") && url.pathname !== "/health") return apiOnlyHost ? json({ error: "Not found" }, 404, cors(request)) : adminPage();
      return json({ error: "Not found" }, 404, cors(request));
    } catch (error) {
      return json({
        error: "Internal licence service error",
        code: "LICENSE_SERVICE_ERROR",
        detail: String(error?.message || error)
      }, 500, cors(request));
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map