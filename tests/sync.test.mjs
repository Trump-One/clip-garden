import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const png = 'data:image/png;base64,' + readFileSync(new URL('../desktop/icon.png', import.meta.url)).toString('base64');
import { createApp } from '../server/index.mjs';
const { Garden, initialState } = createRequire(import.meta.url)('../desktop/core.cjs');
async function setup(t, options={}) {
  const app=createApp(options);await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.close(r)));
  const origin=`http://127.0.0.1:${app.address().port}`;
  const request=async(path,data,token)=>{const res=await fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})});return {status:res.status,...await res.json()};};
  const register=async email=>request('/v1/auth/register',{email,password:'test-password-123'});
  const client=()=>{const s=initialState();s.server=origin;return new Garden(s);};
  return {origin,request,register,client};
}
test('authentication, password hashing behavior, revocation, origin isolation',async t=>{
 const {request,register,origin}=await setup(t);const a=await register('one@example.com');assert.equal(a.status,201);
 assert.equal((await request('/v1/auth/login',{email:'one@example.com',password:'wrong-password'})).status,401);
 assert.equal((await request('/v1/me',undefined,a.token)).id,a.user.id);
 const csrf=await fetch(origin+'/v1/auth/login',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});assert.equal(csrf.status,403);
 await request('/v1/auth/logout',{},a.token);assert.equal((await request('/v1/me',undefined,a.token)).status,401);
});
test('two devices converge; text, image, pin and tombstone cross devices',async t=>{
 const {client,register}=await setup(t);const auth=await register('two@example.com'),a=client(),b=client();a.useSession(auth);b.useSession(auth);
 const clip=a.capture('text','共同的小记忆');a.capture('image',png);await a.sync();await b.sync();assert.equal(b.snapshot().items.length,2);
 b.edit(clip.id,{pinned:true});await b.sync();await a.sync();assert.equal(a.space.items.find(i=>i.id===clip.id).pinned,true);
 a.edit(clip.id,{deleted:true});await a.sync();await b.sync();assert.equal(b.snapshot().items.length,1);assert.equal(b.space.items.find(i=>i.id===clip.id).content,'');
});
test('account isolation and explicit guest migration',async t=>{
 const {client,register}=await setup(t);const auth=await register('a@example.com'),other=await register('b@example.com'),a=client(),b=client();
 a.capture('text','只属于游客');a.useSession(auth,false);await a.sync();b.useSession(auth);await b.sync();assert.equal(b.snapshot().items.length,0);
 await a.logout();assert.equal(a.snapshot().items[0].content,'只属于游客');
 const renewed=await register('c@example.com');a.useSession(renewed,true);await a.sync();b.useSession(renewed);await b.sync();assert.equal(b.snapshot().items[0].content,'只属于游客');
 b.useSession(other);await b.sync();assert.equal(b.snapshot().items.length,0);
});
test('operation replay idempotency and stale revision conflict',async t=>{
 const {request,register}=await setup(t);const auth=await register('idempotent@example.com');const now=Date.now();
 const op={id:randomUUID(),opId:randomUUID(),baseRevision:0,payload:{kind:'text',content:'hello',copyCount:1,deleted:false,pinned:false,createdAt:now,lastCopiedAt:now}};
 const one=await request('/v1/sync',{operations:[op]},auth.token),two=await request('/v1/sync',{operations:[op]},auth.token);
 assert.equal(one.changes[0].revision,1);assert.equal(two.accepted[0].revision,1);assert.equal(two.changes.length,1);
 const stale=await request('/v1/sync',{operations:[{...op,opId:randomUUID()}]},auth.token);assert.equal(stale.conflicts.length,1);
 const other=await register('other@example.com');const empty=await request('/v1/sync',{},other.token);assert.equal(empty.changes.length,0);
});
test('simultaneous offline changes preserve both versions',async t=>{
 const {client,register}=await setup(t);const auth=await register('conflict@example.com'),a=client(),b=client();a.useSession(auth);b.useSession(auth);
 const c=a.capture('text','共同版本');await a.sync();await b.sync();a.edit(c.id,{pinned:true});b.edit(c.id,{pinned:true});await a.sync();await b.sync();await a.sync();
 assert.equal(a.snapshot().items.length,2);assert.equal(b.snapshot().items.length,2);assert.match(b.message,/冲突/);
});
test('network failure retains outbox and offline guest does not send requests',async()=>{
 let calls=0;const g=new Garden(initialState(),()=>{},async()=>{calls++;throw new Error('offline');});g.capture('text','offline guest');await g.sync();assert.equal(calls,0);
 g.useSession({user:{id:randomUUID()},token:'x'},true);await g.sync();assert.equal(g.snapshot().pending,1);assert.equal(g.snapshot().items.length,1);assert.match(g.message,/offline/);
});
test('Huawei unconfigured fails explicitly',async t=>{
 const {request}=await setup(t,{env:{}});assert.equal((await request('/v1/auth/huawei/start',{})).status,503);
});
test('Huawei flow state, poll secret and single-use callback',async t=>{
 const {request,origin}=await setup(t,{env:{HUAWEI_CLIENT_ID:'id',HUAWEI_CLIENT_SECRET:'secret',HUAWEI_REDIRECT_URI:'https://example.com/callback'},upstreamFetch:async url=>({ok:true,json:async()=>url.includes('/token')?{access_token:'verified-token'}:{openID:'verified-openid'}})});
 const flow=await request('/v1/auth/huawei/start',{});assert.equal(flow.status,200);
 assert.equal((await request('/v1/auth/huawei/callback?state=bad&code=code')).status,400);
 assert.equal((await request('/v1/auth/huawei/poll',{id:flow.id,pollSecret:'bad'})).status,400);
 const state=new URL(flow.url).searchParams.get('state');
 assert.equal((await fetch(origin+'/v1/auth/huawei/callback?state='+state+'&code=good')).status,200);
 assert.equal((await request('/v1/auth/huawei/callback?state='+state+'&code=replay')).status,400);
 const result=await request('/v1/auth/huawei/poll',{id:flow.id,pollSecret:flow.pollSecret});assert.ok(result.token);assert.equal(result.user.email,'华为账号');
 assert.equal((await request('/v1/auth/huawei/poll',{id:flow.id,pollSecret:flow.pollSecret})).status,400);
});

test('native Huawei authorization exchanges its code only on the server',async t=>{
 const calls=[];
 const {request}=await setup(t,{env:{HUAWEI_CLIENT_ID:'id',HUAWEI_CLIENT_SECRET:'secret',HUAWEI_REDIRECT_URI:'http://127.0.0.1:4318/v1/auth/huawei/callback'},upstreamFetch:async (url,options)=>{calls.push({url,body:String(options.body)});return {ok:true,json:async()=>url.includes('/token')?{access_token:'verified-token'}:{openID:'native-openid'}};}});
 const state=randomUUID();
 assert.equal((await request('/v1/auth/huawei/native',{authorizationCode:'short',state})).status,400);
 const result=await request('/v1/auth/huawei/native',{authorizationCode:'one-time-code',state});
 assert.equal(result.status,200);assert.ok(result.token);assert.equal(result.user.email,'华为账号');
 assert.equal(calls.length,2);assert.match(calls[0].url,/oauth2\/v3\/token/);assert.match(calls[0].body,/client_secret=secret/);
 assert.match(calls[0].body,/redirect_uri=http%3A%2F%2F127.0.0.1%3A4318/);
 assert.match(calls[1].url,/GOpen\.User\.getInfo/);
});

test('image deletion and a new image in the same batch converge',async t=>{
 const {client,register}=await setup(t);const auth=await register('image-delete@example.com'),a=client(),b=client();a.useSession(auth);b.useSession(auth);
 const old=a.capture('image',png);await a.sync();await b.sync();a.edit(old.id,{deleted:true});const replacement=a.capture('image',png);await a.sync();
 assert.equal(a.snapshot().pending,0,a.message);await b.sync();assert.equal(b.snapshot().items.length,1);assert.equal(b.snapshot().items[0].id,replacement.id);assert.equal(b.space.items.find(i=>i.id===old.id).deleted,true);
});
