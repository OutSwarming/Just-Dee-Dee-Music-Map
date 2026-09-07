import {readFile,mkdir,writeFile,rename,readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import notificationPolicy from '../../functions/discordNotifications.js';
export const SUPPORT=path.join(homedir(),'Library','Application Support','Just Dee Dee Music Map');
export async function config(){return JSON.parse(await readFile(path.join(SUPPORT,'notification-routing.json'),'utf8'));}
export function splitMessage(body,limit=1850){const parts=[];let rest=String(body);while(rest.length>limit){let n=rest.lastIndexOf('\n',limit);if(n<limit/2)n=limit;if(/[\uD800-\uDBFF]/.test(rest[n-1]))n--;parts.push(rest.slice(0,n));rest=rest.slice(n).replace(/^\n/,'');}if(rest)parts.push(rest);return parts;}
export async function dailyDigest({summary=false}={}){const c=await config();const r=await fetch('https://us-central1-just-dee-dee-music-map.cloudfunctions.net/jddmNotificationDigest'+(summary?'?summary=1':''),{headers:{'x-jddm-key':c.digestKey},signal:AbortSignal.timeout(60000)});const d=await r.json();if(!r.ok||!d.ok)throw Error('Daily follow-up list could not be loaded');return d;}
export async function postNotification(kind,body,{key,fetchImpl=fetch,alert=false}={}){
 const c=await config(),channel=c.channels[kind];if(!channel)throw Error('Unconfigured Discord notification kind: '+kind);
 const id=createHash('sha256').update(key||kind+'|'+body).digest('hex');const dir=path.join(SUPPORT,'discord-notification-receipts');await mkdir(dir,{recursive:true});const file=path.join(dir,id+'.json');let receipt={next:0,kind,body,alert:alert&&['ai-daily-summary','daily-follow-ups'].includes(kind),key:key||kind+'|'+body};try{receipt=JSON.parse(await readFile(file,'utf8'));}catch{}if(receipt.sent)return {duplicate:true,channel};
 await writeFile(file,JSON.stringify(receipt),{mode:0o600});
 const parts=splitMessage(body);for(let i=receipt.next;i<parts.length;i++){
 let r,d;for(let attempt=0;attempt<3;attempt++){r=await fetchImpl('https://discord.com/api/v10/channels/'+channel+'/messages',{method:'POST',headers:{Authorization:'Bot '+c.botToken,'Content-Type':'application/json'},body:JSON.stringify({...notificationPolicy.notificationBody(parts[i],{alert:receipt.alert===true&&['ai-daily-summary','daily-follow-ups'].includes(kind),part:i}),nonce:id.slice(0,20)+String(i).padStart(4,'0'),enforce_nonce:true}),signal:AbortSignal.timeout(30000)});d=await r.json();if(r.status!==429)break;await new Promise(resolve=>setTimeout(resolve,Math.min(10000,Number(d.retry_after||1)*1000+100)));}
 if(!r.ok)throw Error('Discord notification failed: '+r.status);receipt.next=i+1;await writeFile(file+'.tmp',JSON.stringify(receipt),{mode:0o600});await rename(file+'.tmp',file);
 }receipt.sent=true;await writeFile(file,JSON.stringify(receipt),{mode:0o600});return {sent:parts.length,channel};
}

export async function retryNotifications(){
 const dir=path.join(SUPPORT,'discord-notification-receipts');let files=[];try{files=await readdir(dir);}catch(e){if(e.code==='ENOENT')return;throw e;}
 for(const file of files.filter(n=>n.endsWith('.json'))){const r=JSON.parse(await readFile(path.join(dir,file),'utf8'));if(!r.sent&&r.kind&&r.body)await postNotification(r.kind,r.body,{key:r.key,alert:r.alert===true});}
}
