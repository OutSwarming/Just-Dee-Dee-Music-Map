const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {assertProject}=require('../scripts/check-firebase-project.cjs');
test('deployment rejects Bark Ranger, missing, and unknown projects',()=>{
  assert.doesNotThrow(()=>assertProject('just-dee-dee-music-map'));
  for(const p of ['barkrangermap-auth','','another-project'])assert.throws(()=>assertProject(p));
});
test('active cloud and browser endpoints stay in the JDDM project',()=>{
  for(const f of ['config/firebaseConfig.example.js','functions/calendarVenueReview.js','functions/venueLinks.js','functions/followUpDigest.js','functions/venueWorklist.js','google-apps-script/jddm-spreadsheet-bridge/CalendarReview.gs']){
    assert.doesNotMatch(fs.readFileSync(require('node:path').join(__dirname,'..',f),'utf8'),/https:\/\/us-central1-barkrangermap-auth\.cloudfunctions\.net\//,f);
  }
});
