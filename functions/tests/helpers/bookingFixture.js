'use strict';
const assert=require('node:assert/strict');
const b=require('../../bookingTracker');
function fixture({discord:realDiscord,config}={}){
 const store=new Map(),messages=new Map(),calls=[],channels=new Map();let clock=new Date('2026-09-09T12:00:00Z'),sequence=0,revision=0;
 const rows=[{'Place ID':'preflight-fake-venue','Place Name':'TEST ONLY — Fake Venue — booking preflight',Status:'Played in the Past','Email/Contact':'booking@example.com','Next Follow Up':''}];
 const cfg=config||{enabled:true,forumId:'fake-forum',tags:Object.fromEntries(Object.keys(b.STATES).map(x=>[x,x])),mapTags:{}};
 store.set(b.PREFIX+'/config',cfg);
 const ref=path=>({path,get:async()=>({exists:store.has(path),data:()=>structuredClone(store.get(path))}),set:async(v,o)=>store.set(path,{...(o?.merge?store.get(path):{}),...structuredClone(v)})});
 const docs=(name,p=()=>true)=>[...store].filter(([k,v])=>k.startsWith(name+'/')&&p(v)).map(([k,v])=>({id:k.split('/').at(-1),data:()=>structuredClone(v)}));
 const db={doc:ref,collection:name=>({get:async()=>({docs:docs(name)}),where:(f,op,v)=>({get:async()=>({docs:docs(name,x=>op==='=='?x[f]===v:x[f]>v)})})}),runTransaction:fn=>fn({get:r=>r.get(),set:(r,v,o)=>r.set(v,o)})};
 const sheet={list:async()=>structuredClone(rows),get:async()=>structuredClone(rows[0]),save:async(id,patch,expected)=>{assert.equal(id,rows[0]['Place ID']);for(const[k,v]of Object.entries(expected))assert.equal(rows[0][k]||'',v);Object.assign(rows[0],patch);}};
 const discord=async(method,path,body)=>{calls.push({method,path,body});if(realDiscord)return realDiscord(method,path,body);if(method==='POST'&&path.endsWith('/threads')){const id='fake-post-'+(++sequence);channels.set(id,{id,name:body.name,thread_metadata:{archived:false}});return{id};}if(method==='GET')return channels.get(path.split('/')[2])||{};return{id:'fake-message-'+(++sequence)};};
 // No Gmail send/create/modify methods exist. All mailbox events are simulated in memory.
 const gmail={users:{
  getProfile:async()=>({data:{emailAddress:b.MAILBOX,historyId:String(revision)}}),
  drafts:{list:async()=>({data:{drafts:[...messages.values()].filter(m=>m.labelIds.includes('DRAFT')).map(m=>({id:'draft-'+m.id,message:{id:m.id}}))}})},
  messages:{list:async()=>({data:{messages:[...messages.values()].filter(m=>m.labelIds.includes('SENT')).map(m=>({id:m.id}))}}),get:async({id})=>{if(!messages.has(id))throw Object.assign(Error('not found'),{code:404});return{data:structuredClone(messages.get(id))};}},
  threads:{get:async({id})=>({data:{messages:[...messages.values()].filter(m=>m.threadId===id)}})},
  history:{list:async()=>({data:{history:[{messagesAdded:[...messages.values()].map(message=>({message}))}]}})}
 }};
 const service=b.createService({db,sheet,discord,gmail,now:()=>clock});
 const put=({id,threadId='fake-thread',labels=['INBOX'],from=b.MAILBOX,to='booking@example.com',subject='2027 booking TEST ONLY',body='Simulated booking message; no email was sent.',at=clock.getTime(),extraHeaders=[]})=>{revision++;messages.set(id,{id,threadId,labelIds:labels,internalDate:String(at),payload:{mimeType:'text/plain',headers:[{name:'From',value:from},{name:'To',value:to},{name:'Subject',value:subject},{name:'Message-ID',value:'<'+id+'@example.com>'},...extraHeaders],body:{data:Buffer.from(body).toString('base64url')}}});};
 return {store,db,rows,sheet,calls,gmail,service,messages,put,clock:value=>clock=new Date(value),task:()=>service.get(b.hash(rows[0]['Place ID']))};
}
module.exports={fixture};
