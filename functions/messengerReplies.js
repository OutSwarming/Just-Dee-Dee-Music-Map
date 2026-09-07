'use strict';

const crypto = require('node:crypto');
const {verifyDiscordSignature} = require('./discordEmailInteractions');
const {GUILD_ID} = require('./discordConversations');
const {PAGE_ID, INSTAGRAM_ID, PLATFORMS} = require('./messengerInbox');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const quiet = {parse:[]};

function createTransport(token, fetchImpl=fetch) {
    return async (path, body) => {
        let response;
        try {
            response = await fetchImpl('https://graph.facebook.com/v26.0/'+path, {
                method:body ? 'POST' : 'GET',
                headers:{Authorization:'Bearer '+token, 'Content-Type':'application/json'},
                ...(body ? {body:JSON.stringify(body)} : {}),
                signal:AbortSignal.timeout(30000)
            });
        } catch (_) {
            throw Object.assign(Error('Meta did not confirm the result. Check the original inbox before sending again.'), {uncertain:Boolean(body)});
        }
        const data = await response.json().catch(()=>null);
        if (!response.ok) {
            const detail = data?.error?.message || 'Request failed';
            throw Object.assign(Error(`Meta ${data?.error?.code || response.status}: ${detail}`), {uncertain:Boolean(body && response.status>=500)});
        }
        if (!data) throw Object.assign(Error('Meta returned an unreadable result. Check the original inbox.'), {uncertain:Boolean(body)});
        return data;
    };
}

function compose(platform, id) {
    const label = PLATFORMS[platform].label;
    return {type:9, data:{custom_id:`jddms:send:${platform}:${id}`, title:`Reply via ${label}`, components:[{
        type:1, components:[{type:4, custom_id:'message', style:2, required:true, max_length:platform==='instagram'?1000:1900,
            label:'Submit sends as Just Dee Dee Music', placeholder:'Write your reply to this conversation…'}]
    }]}};
}

function createService({db, transport, inboxes, now=()=>Date.now()}) {
    async function send({platform,id,channelId,actionId,text,actor}) {
        const p = PLATFORMS[platform], inbox = inboxes[platform];
        if (!p || !inbox) throw Error('Unknown messaging account.');
        const c = await inbox.get(id);
        if (!c || c.platform!==platform || c.discordThreadId!==channelId) throw Error('Open the original conversation post to reply.');
        text = String(text||'').trim();
        if (!text || text.length>(platform==='instagram'?1000:1900) || (platform==='instagram'&&Buffer.byteLength(text,'utf8')>1000)) {
            throw Error(platform==='instagram'?'Keep the Instagram reply within 1,000 bytes; emojis use extra space.':'Enter a reply of up to 1,900 characters.');
        }
        if (!actionId) throw Error('Missing send request.');
        const request = db.doc('jddmSocialSends/'+hash(platform+':'+actionId));
        const prior = (await request.get()).data();
        if (prior?.state==='sent') return {sent:true,duplicate:true,name:c.name,messageId:prior.messageId};
        if (prior) throw Error('This send was already attempted. Check the original inbox before retrying.');

        const account = await transport('me?fields=id,name');
        if (account.id!==PAGE_ID) throw Error('The connected Facebook Page is not Just Dee Dee Music.');
        if (platform==='instagram') {
            const linked = await transport(PAGE_ID+'?fields=instagram_business_account');
            if (linked.instagram_business_account?.id!==INSTAGRAM_ID) throw Error('The connected Instagram account changed.');
        }
        const thread = await transport(encodeURIComponent(c.sourceId || c.id)+'?fields=id,participants'+(platform==='messenger'?',link':''));
        const people = thread.participants?.data || [];
        const others = people.filter(person=>person.id!==p.selfId);
        if (!people.some(person=>person.id===p.selfId) || others.length!==1 || others[0].id!==c.psid) {
            throw Error('The source recipient could not be verified. Nothing was sent.');
        }
        const recent = await transport(encodeURIComponent(thread.id)+'/messages?fields=id,from,to,created_time,message,attachments,shares&limit=100');
        const inbound = Math.max(0,...(recent.data||[]).filter(m=>m.from?.id===c.psid).map(m=>Date.parse(m.created_time)).filter(Number.isFinite));
        if (!inbound || inbound>now()+60000 || now()-inbound>=24*60*60*1000) {
            throw Error('Meta’s 24-hour reply window has closed. Open the original inbox to review the available contact options.');
        }
        const duplicate = db.doc('jddmSocialSendContent/'+hash(platform+':'+id+':'+text));
        await db.runTransaction(async tx=>{
            const old = (await tx.get(duplicate)).data();
            const same = (await tx.get(request)).data();
            if (same) throw Error('This send is already being handled.');
            if (old && (['sending','unknown'].includes(old.state) || (old.state==='sent'&&now()-old.at<5*60*1000))) {
                throw Error('This same reply was already sent or is awaiting confirmation. Check the conversation before retrying.');
            }
            const state = {state:'sending',at:now(),platform,conversationId:id,recipient:c.psid,actor,actionId};
            tx.set(request,state); tx.set(duplicate,state);
        });
        let result;
        try {
            result = await transport(PAGE_ID+'/messages', {recipient:{id:c.psid}, message:{text}, ...(platform==='messenger'?{messaging_type:'RESPONSE'}:{})});
            if (!result.message_id) throw Object.assign(Error('Meta did not return a message confirmation. Check the original inbox.'),{uncertain:true});
        } catch (error) {
            const patch = {state:error.uncertain?'unknown':'rejected',error:error.message};
            await request.set(patch,{merge:true}); await duplicate.set(patch,{merge:true});
            throw error;
        }
        const patch = {state:'sent',messageId:result.message_id,sentAt:now()};
        await request.set(patch,{merge:true}); await duplicate.set(patch,{merge:true});
        let syncPending = false;
        try {
            await inbox.syncConversation({...thread, messages:[...(recent.data||[]),{id:result.message_id,from:{id:p.selfId,name:'Just Dee Dee Music'},
                to:{data:[others[0]]},message:text,created_time:new Date(now()).toISOString()}]});
        } catch (_) { syncPending = true; }
        return {sent:true,name:c.name,messageId:result.message_id,syncPending};
    }
    return {send};
}

function interactions({publicKey,discord,service,inboxes}) {
    return async (req,res) => {
        if (!verifyDiscordSignature({publicKey:publicKey(),signature:req.get('X-Signature-Ed25519'),timestamp:req.get('X-Signature-Timestamp'),rawBody:req.rawBody||JSON.stringify(req.body)})) return res.status(401).send('Invalid signature');
        const i=req.body, [,action,platform,id] = String(i.data?.custom_id||'').split(':');
        if (i.guild_id!==GUILD_ID || !i.member?.user?.id || !PLATFORMS[platform] || !/^[a-zA-Z0-9_-]{1,50}$/.test(id||'')) return res.status(403).send('Use a JDDM conversation.');
        if (action==='reply' && i.type===3) return res.json(compose(platform,id));
        if (action!=='send' || i.type!==5) return res.status(400).send('Unknown reply action');
        await discord('POST',`/interactions/${i.id}/${i.token}/callback`,{type:5,data:{flags:64}});
        const text=i.data.components?.flatMap(c=>c.components||[]).find(c=>c.custom_id==='message')?.value||'';
        let content,embeds=[];
        try {
            const r=await service.send({platform,id,channelId:i.channel_id,actionId:i.id,text,actor:i.member.user.id});
            content=`✅ ${r.duplicate?'Already sent':'Sent'} as Just Dee Dee Music via ${PLATFORMS[platform].label} to **${r.name}**.\n${r.syncPending?'Sent successfully; its Discord copy is pending the next inbox check. Do not resend.':'The reply is in this conversation, which is now waiting on the venue.'}`;
        } catch (error) {
            content=`⚠️ ${error.message}`;embeds=[{title:'Your reply text',description:String(text).slice(0,4000)||'(empty)'}];
        }
        const c=await inboxes[platform].get(id);
        await discord('PATCH',`/webhooks/${i.application_id}/${i.token}/messages/@original`,{content:content.slice(0,2000),embeds,allowed_mentions:quiet,
            components:c?.discordThreadId===i.channel_id?[{type:1,components:[{type:2,style:5,label:'Open original inbox',url:platform==='instagram'?`https://business.facebook.com/latest/inbox/instagram_direct?asset_id=${PAGE_ID}`:`https://business.facebook.com/latest/inbox/messenger?asset_id=${PAGE_ID}`}]}]:[]});
        return res.status(202).send('handled');
    };
}

module.exports={createTransport,compose,createService,interactions};
