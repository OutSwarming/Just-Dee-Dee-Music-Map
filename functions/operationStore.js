'use strict';
// Canonical documents remain authoritative. Materialized collection reads are
// enabled only after every application writer has been upgraded. A writer updates
// its source and materialization atomically; unsupported values invalidate it.
const {AsyncLocalStorage}=require('node:async_hooks');
const {gzipSync,gunzipSync}=require('node:zlib');
const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const PROJECT='just-dee-dee-music-map', CONTROL='jddmEfficiency/config', CACHE='jddmEfficiencySnapshots';
const COLLECTIONS=new Set(['jddmBooking2027Venues','jddmBooking2027Mail','jddmBookingDrafts','jddmBooking2027Jobs','jddmEmailConversations','jddmMessengerConversations','jddmInstagramConversations','jddmVoiceConversations','jddmCalendarReviews','jddmLinkingReviews','jddmVenueWorklistTasks','jddmVenueIdentities']);
const MAX_BYTES=650000,MAX_AGE=6*60*60*1000,context=new AsyncLocalStorage(),wrapped=new WeakMap(),rawRefs=new WeakMap();
function metric(collection,kind,count=1){const c=context.getStore();if(!c)return;const key=collection||'unknown';c.collections[key] ||= {};c.collections[key][kind]=(c.collections[key][kind]||0)+count;}
function recordRead(name,snap){metric(name,'readRequests');metric(name,'documentReads',snap.docs?Math.max(1,snap.size??snap.docs.length):1);if(snap.docs&&!snap.docs.length)metric(name,'emptyQueries');return snap;}
async function measured(name,fn){if(context.getStore())return fn();const state={process:name,started:Date.now(),collections:{},status:'ok'};return context.run(state,async()=>{try{return await fn();}catch(e){state.status='error';throw e;}finally{console.log('[jddm-io]',JSON.stringify({version:1,release:'efficiency-v1',process:name,status:state.status,durationMs:Date.now()-state.started,collections:state.collections}));}});}
function instrument(fn,name){const result=function(...args){return measured(name,()=>fn.apply(this,args));};for(const [key,d]of Object.entries(Object.getOwnPropertyDescriptors(fn))){if(!['length','name','prototype','arguments','caller'].includes(key))Object.defineProperty(result,key,d);}if(fn.run)result.run=(...args)=>measured(name,()=>fn.run(...args));return result;}
function normalize(v){if(typeof v==='number'&&(!Number.isFinite(v)||Object.is(v,-0)))throw Error('Special numbers require authoritative reads');if(v===null||['string','number','boolean'].includes(typeof v))return v;if(Array.isArray(v))return v.map(normalize);if(v&&Object.getPrototypeOf(v)===Object.prototype){return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,normalize(x)]));}throw Error('Materialization accepts only plain JSON values');}
function digest(v){return createHash('sha256').update(JSON.stringify(normalize(v))).digest('hex');}
function same(a,b,omit=[]){if(a==null||b==null)return a===b;const clean=x=>Object.fromEntries(Object.entries(x||{}).filter(([k])=>!omit.includes(k)));return isDeepStrictEqual(clean(a),clean(b));}
function pack(values){const packed=gzipSync(Buffer.from(JSON.stringify(normalize(values)))).toString('base64');if(Buffer.byteLength(packed)>MAX_BYTES)throw Error('Materialization exceeds safe size');return packed;}
function unpack(state){if(state?.schema!==1||state.valid!==true||typeof state.packed!=='string')return null;try{return JSON.parse(gunzipSync(Buffer.from(state.packed,'base64'),{maxOutputLength:32*1024*1024}).toString());}catch{return null;}}
function merge(base,patch){const result={...(base||{})};for(const[k,v]of Object.entries(patch)){if(v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length)result[k]=merge(result[k],v);else result[k]=v;}return result;}
function apply(before,method,args){if(method==='delete')return undefined;if(method==='update'&&(!args[0]||Object.getPrototypeOf(args[0])!==Object.prototype))throw Error('FieldPath updates require rebuild');const value=normalize(args[0]);if(method==='set'){if(args[1]?.mergeFields)throw Error('Explicit mergeFields requires rebuild');return args[1]?.merge?merge(before,value):value;}if(method==='create')return value;if(method==='update'){const next=structuredClone(before||{});for(const[k,v]of Object.entries(value)){const parts=k.split('.');let target=next;for(const part of parts.slice(0,-1)){if(!target[part]||typeof target[part]!=='object'||Array.isArray(target[part]))target[part]={};target=target[part];}target[parts.at(-1)]=v;}return next;}throw Error('Unsupported mutation');}
function operationDb(db){if(!db||db.__jddmOperationDb)return db;
 // Unit-test fixtures without a project are intentionally native. Emulator tests
 // set the demo project explicitly and exercise the complete wrapper.
 let project;try{project=db.projectId;}catch(e){if(process.env.NODE_ENV==='test')return db;throw e;}if(!project)return db;if(project!==PROJECT&&!project.startsWith('demo-'))throw Error('JDDM operation store refuses foreign project');
 if(wrapped.has(db))return wrapped.get(db);let proxy;
 const unwrap=x=>rawRefs.get(x)||x;
 const rawGet=async (ref,args=[],name)=>{const read=()=>ref.get(...args).then(s=>recordRead(name||ref.path?.split('/')[0],s));const c=context.getStore();if(c&&!args.length&&/^jddm(?:Email|Voice|Messenger|Instagram)Config\/main$/.test(ref.path||'')){c.readMemo ||= new Map();if(!c.readMemo.has(ref.path))c.readMemo.set(ref.path,read());return c.readMemo.get(ref.path);}return read();};
 const cacheRef=name=>db.doc(CACHE+'/'+name);
 async function enabled(){const c=context.getStore();if(c?.enabled!==undefined)return c.enabled;const yes=(await rawGet(db.doc(CONTROL))).data()?.enabled===true;if(c)c.enabled=yes;return yes;}
 function synthetic(name,values){const docs=Object.entries(values).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(([id,data])=>({id,exists:true,ref:proxy.doc(name+'/'+id),data:()=>structuredClone(data)}));return {docs,size:docs.length,empty:!docs.length,forEach:fn=>docs.forEach(fn)};}
 async function collectionGet(ref){const name=ref.path;if(!COLLECTIONS.has(name)||!await enabled())return rawGet(ref);
  const saved=(await rawGet(cacheRef(name))).data(),values=unpack(saved);
  if(values&&Date.now()-(saved.builtAt||0)<MAX_AGE){metric(name,'snapshotHits');metric(name,'recordsDelivered',Object.keys(values).length);return synthetic(name,values);}
  // Rebuild inside the same transaction lock observed by all upgraded writers.
  // A malformed, expired or invalidated cache never supplies stale records.
  let didWrite=false;const result=await db.runTransaction(async tx=>{didWrite=false;metric(CACHE,'transactionAttempts');const s=recordRead(CACHE,await tx.get(cacheRef(name))).data(),current=unpack(s);if(current&&Date.now()-(s.builtAt||0)<MAX_AGE)return synthetic(name,current);
   const source=recordRead(name,await tx.get(ref)),data=Object.fromEntries(source.docs.map(d=>[d.id,d.data()]));try{const packed=pack(data);tx.set(cacheRef(name),{schema:1,valid:true,packed,builtAt:Date.now()});didWrite=true;metric(CACHE,'writesAttempted');}catch{metric(name,'snapshotFallbacks');return source;}metric(name,'snapshotRebuilds');return synthetic(name,data);
  });if(didWrite)metric(CACHE,'writesConfirmed');return result;
 }
 async function transaction(fn,options){let confirmed=[];const result=await db.runTransaction(async raw=>{metric('_transactions','attempts');const writes=[],seen=new Map();const tx={
  get:async(ref,...args)=>{const r=unwrap(ref),s=recordRead(r.path?.split('/')[0],await raw.get(r,...args));if(r.path&&!s.docs)seen.set(r.path,s);return s;},
  getAll:async(...refs)=>{const results=[];for(const ref of refs)results.push(await tx.get(ref));return results;}
 };for(const method of ['set','create','update','delete'])tx[method]=(ref,...args)=>{writes.push({ref:unwrap(ref),method,args});return tx;};const output=await fn(tx);if(writes.length&&context.getStore())context.getStore().readMemo=new Map();
 const names=[...new Set(writes.map(w=>w.ref.path.split('/')).filter(p=>p.length===2&&COLLECTIONS.has(p[0])).map(p=>p[0]))],mirrors=new Map();
 for(const name of names){const state=recordRead(CACHE,await raw.get(cacheRef(name))).data();mirrors.set(name,{state,values:unpack(state)});}
 for(const w of writes){const parts=w.ref.path.split('/');if(parts.length!==2||!COLLECTIONS.has(parts[0]))continue;const mirror=mirrors.get(parts[0]);if(!mirror.values)continue;let source=seen.get(w.ref.path);if(!source){source=recordRead(parts[0],await raw.get(w.ref));seen.set(w.ref.path,source);}try{
   // A legacy/out-of-band write is visible before its repair event. Invalidate
   // rather than merging it into a potentially inconsistent snapshot.
   if(!same(source.data(),mirror.values[parts[1]])){mirror.invalid=true;continue;}
   const prior=Object.hasOwn(mirror.pending||{},parts[1])?mirror.pending[parts[1]]:source.data(),next=apply(prior,w.method,w.args);mirror.pending ||= {};mirror.pending[parts[1]]=next;
  }catch{mirror.invalid=true;}
 }
 for(const w of writes){raw[w.method](w.ref,...w.args);metric(w.ref.path.split('/')[0],'writesAttempted');}
 for(const[name,m]of mirrors){if(!m.values)continue;let state;try{if(m.invalid)throw Error('rebuild');for(const[id,v]of Object.entries(m.pending||{})){if(v===undefined)delete m.values[id];else m.values[id]=v;}state={schema:1,valid:true,packed:pack(m.values),builtAt:m.state.builtAt};}catch{state={schema:1,valid:false,builtAt:0};}raw.set(cacheRef(name),state);metric(CACHE,'writesAttempted');}
 confirmed=[...writes.map(w=>[w.ref.path.split('/')[0],w.method]),...names.filter(n=>mirrors.get(n).values).map(()=>[CACHE,'set'])];return output;
 },options);for(const[n,method]of confirmed)metric(n,method==='delete'?'deletesConfirmed':'writesConfirmed');return result;}
 function wrapRef(ref,bare=false,name=ref.path?.split('/')[0]){const p=new Proxy(ref,{get(target,key){if(key==='get')return(...args)=>bare&&!args.length?collectionGet(target):rawGet(target,args,name);if(key==='doc')return(...args)=>wrapRef(target.doc(...args));if(key==='collection')return(...args)=>wrapRef(target.collection(...args),true);if(['where','orderBy','limit','limitToLast','offset','startAt','startAfter','endAt','endBefore','select'].includes(key))return(...args)=>wrapRef(target[key](...args),false,name);if(['set','create','update','delete'].includes(key))return(...args)=>{
  if(target.path.split('/').length===2&&COLLECTIONS.has(target.path.split('/')[0]))return transaction(tx=>tx[key](p,...args));
  if(context.getStore())context.getStore().readMemo=new Map();metric(target.path.split('/')[0],'writesAttempted');return target[key](...args).then(result=>{metric(target.path.split('/')[0],key==='delete'?'deletesConfirmed':'writesConfirmed');return result;});
 };const value=target[key];return typeof value==='function'?value.bind(target):value;}});rawRefs.set(p,ref);return p;}
 proxy=new Proxy(db,{get(target,key){if(key==='__jddmOperationDb')return true;if(key==='__raw')return db;if(key==='doc')return p=>wrapRef(db.doc(p));if(key==='collection')return p=>wrapRef(db.collection(p),true);if(key==='runTransaction')return transaction;if(key==='getAll')return(...refs)=>Promise.all(refs.map(r=>rawGet(unwrap(r))));if(key==='batch')return()=>{const ops=[];const b={commit:()=>transaction(tx=>{for(const[m,r,args]of ops)tx[m](r,...args);})};for(const m of ['set','create','update','delete'])b[m]=(r,...args)=>{ops.push([m,r,args]);return b;};return b;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});wrapped.set(db,proxy);return proxy;
}
async function repair(db,name,id){if(!COLLECTIONS.has(name))return {ignored:true};const raw=db.__raw||db;const result=await raw.runTransaction(async tx=>{const ref=raw.doc(CACHE+'/'+name),s=recordRead(CACHE,await tx.get(ref)).data(),values=unpack(s);if(!values)return {invalid:true};const d=recordRead(name,await tx.get(raw.doc(name+'/'+id)));if(same(d.data(),values[id]))return {unchanged:true};
 // An unwrapped writer is not allowed to make the rest of a snapshot look valid.
 // Invalidation forces a complete authoritative rebuild on the next read.
 tx.set(ref,{schema:1,valid:false,builtAt:0});metric(CACHE,'writesAttempted');return {invalidated:true};});if(result.invalidated)metric(CACHE,'writesConfirmed');return result;}
async function memoCollection(db,name){const c=context.getStore();if(!c)return db.collection(name).get();c.readMemo ||= new Map();if(!c.readMemo.has(name))c.readMemo.set(name,db.collection(name).get());return c.readMemo.get(name);}
module.exports={memoCollection,operationDb,measured,instrument,repair,COLLECTIONS,CONTROL,CACHE,pack,unpack,apply,same,digest,metric,context};
