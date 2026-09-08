'use strict';
const crypto = require('node:crypto');
const ACCOUNTS = {messenger:'104617019336673', instagram:'17841459797433647'};
// The restriction document contains no message text or raw sender identifier.
function restrictionPath(platform, senderId) {
    if (!ACCOUNTS[platform] || !senderId) throw Error('A supported platform and sender are required.');
    const key=crypto.createHash('sha256').update(platform+':'+ACCOUNTS[platform]+':'+senderId).digest('hex');
    return 'jddmSocialPrivacy/'+key;
}
async function isRestricted(db, platform, senderId) {
    const record=(await db.doc(restrictionPath(platform,senderId)).get()).data();
    return record?.restricted===true;
}
async function restrict(db, platform, senderId) {
    await db.doc(restrictionPath(platform,senderId)).set({restricted:true,updatedAt:new Date().toISOString()});
}
module.exports={restrictionPath,isRestricted,restrict};
