const {createHash,randomUUID}=require('node:crypto');
function createVenueWriteLock(db) {
    return async function withLock(id, fn) {
        const ref=db.doc('jddmSpreadsheetWriteLocks/'+createHash('sha256').update(String(id)).digest('hex'));
        const owner=randomUUID();
        await db.runTransaction(async tx=>{
            const current=(await tx.get(ref)).data();
            if(current?.until>Date.now()) { const e=Error('This venue is saving in another window. Wait a moment and save again.');e.code='VENUE_BUSY';throw e; }
            tx.set(ref,{owner,until:Date.now()+150000});
        });
        try{return await fn();}finally{await db.runTransaction(async tx=>{if((await tx.get(ref)).data()?.owner===owner)tx.set(ref,{until:0},{merge:true});});}
    };
}
module.exports={createVenueWriteLock};
