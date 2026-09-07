'use strict';
// Only the first part of an approved daily alert can ping everyone.
function notificationBody(content,{alert=false,part=0}={}){
 const ping=alert&&part===0;
 return {content:(ping?'@everyone\n':'')+String(content).replace(/@/g,'@\u200b'),allowed_mentions:{parse:ping?['everyone']:[]}};
}
module.exports={notificationBody};
