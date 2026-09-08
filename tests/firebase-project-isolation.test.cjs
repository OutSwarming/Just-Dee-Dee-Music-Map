const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {assertProject}=require('../scripts/check-firebase-project.cjs');
test('deployment rejects Bark Ranger, missing, and unknown projects',()=>{
  assert.doesNotThrow(()=>assertProject('just-dee-dee-music-map'));
  for(const p of ['barkrangermap-auth','','another-project'])assert.throws(()=>assertProject(p));
});
test('active cloud and browser endpoints stay in the JDDM project',()=>{
  for(const f of ['config/firebaseConfig.example.js','functions/index.js','functions/calendarVenueReview.js','functions/venueLinks.js','functions/followUpDigest.js','functions/venueWorklist.js','google-apps-script/jddm-spreadsheet-bridge/CalendarReview.gs','google-apps-script/jddm-spreadsheet-bridge/CalendarMonitor.gs','scripts/dee-dee-local-text-reminders.mjs','scripts/jddm-ai-daily-summary.mjs','scripts/jddm-live-e2e.mjs','scripts/reconcile-jddm-chronological-events.mjs','scripts/sync-artist-gig-tracker.py','scripts/sync-artist-source-audit-to-sheet.py']){
    assert.doesNotMatch(fs.readFileSync(require('node:path').join(__dirname,'..',f),'utf8'),/https:\/\/us-central1-barkrangermap-auth\.cloudfunctions\.net\//,f);
  }
});
test('every deployable configuration enforces the resolved project before deployment',()=>{
  const path=require('node:path');
  const {spawnSync}=require('node:child_process');
  for(const file of ['firebase.json','firebase.inbox.json']){
    const config=JSON.parse(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
    for(const resource of ['functions','hosting','firestore']){
      if(!config[resource]) continue;
      for(const target of [config[resource]].flat()){
        assert.deepEqual(target.predeploy,['node "$PROJECT_DIR/scripts/check-firebase-project.cjs" "$GCLOUD_PROJECT"'],`${file} ${resource}`);
      }
    }
  }
  for(const [project,status] of [['just-dee-dee-music-map',0],['barkrangermap-auth',1],['',1]]){
    assert.equal(spawnSync(process.execPath,[path.join(__dirname,'../scripts/check-firebase-project.cjs'),project]).status,status);
  }
});
