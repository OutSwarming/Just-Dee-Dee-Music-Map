'use strict';
const crypto=require('node:crypto');
const {PAGE_ID,INSTAGRAM_ID}=require('./messengerInbox');
function validSignature(raw,signature,secret){if(!Buffer.isBuffer(raw)||!secret||!/^sha256=[a-f0-9]{64}$/.test(signature||''))return false;const expected=crypto.createHmac('sha256',secret).update(raw).digest();return crypto.timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex'));}
function createHandler({db,appSecret,verifyToken}){return async(req,res)=>{
 if(req.method==='GET'){if(req.query['hub.mode']==='subscribe'&&verifyToken&&req.query['hub.verify_token']===verifyToken)return res.status(200).type('text/plain').send(String(req.query['hub.challenge']||''));return res.status(403).send('Invalid verification');}
 if(req.method!=='POST')return res.status(405).send('Method not allowed');
 if(!validSignature(req.rawBody,req.get('X-Hub-Signature-256'),appSecret))return res.status(401).send('Invalid signature');
 const platform=req.body?.object==='page'?{id:PAGE_ID,namespace:'jddmMessenger'}:req.body?.object==='instagram'?{id:INSTAGRAM_ID,namespace:'jddmInstagram'}:null;
 if(!platform)return res.status(200).send('ignored');
 const entries=(Array.isArray(req.body.entry)?req.body.entry:[]).filter(e=>e.id===platform.id);if(!entries.length)return res.status(200).send('ignored');
 // Save only a wakeup marker. The verified Page API supplies authoritative messages;
 // the scheduled poll handles retries and imports outgoing echoes in the same thread.
 await db.doc(platform.namespace+'Config/webhook').set({pending:true,receivedAt:new Date().toISOString(),entryCount:entries.length});
 return res.status(200).send('EVENT_RECEIVED');
};}
module.exports={validSignature,createHandler};
