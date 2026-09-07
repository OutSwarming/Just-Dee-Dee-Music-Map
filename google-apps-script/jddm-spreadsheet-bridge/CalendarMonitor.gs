/** Five-minute calendar change notifications; no spreadsheet columns are changed. */
var JDDM_CALENDAR_MONITOR_URL = 'https://us-central1-just-dee-dee-music-map.cloudfunctions.net/jddmCalendarChanges';

function runJddmCalendarChangeMonitor() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var key = PropertiesService.getScriptProperties().getProperty('JDDM_CALENDAR_MONITOR_KEY');
    if (!key) throw new Error('Calendar monitoring key is missing.');
    var capturedAt = new Date().toISOString();
    var end = new Date(); end.setFullYear(end.getFullYear() + 2);
    var calendars = JDDM_CALENDAR_IDS.map(function(id) {
      var calendar = CalendarApp.getCalendarById(id);
      if (!calendar) throw new Error('Calendar is unavailable: ' + id);
      var events = calendar.getEvents(new Date('2010-01-01T00:00:00Z'), end).map(function(event) {
        var details = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, event.getDescription() || '');
        return {id:event.getId(),title:event.getTitle(),location:event.getLocation(),start:event.getStartTime().toISOString(),end:event.getEndTime().toISOString(),allDay:event.isAllDayEvent(),color:event.getColor(),details:Utilities.base64Encode(details)};
      });
      return {id:id,name:calendar.getName(),events:events};
    });
    var body = JSON.stringify({version:1,capturedAt:capturedAt,end:end.toISOString(),calendars:calendars}).replace(/[^\x00-\x7F]/g,function(c){return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);});
    var stamp = String(Date.now());
    var bytes = Utilities.computeHmacSha256Signature(stamp + '.' + body, key);
    var signature = bytes.map(function(b){ return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    var response = UrlFetchApp.fetch(JDDM_CALENDAR_MONITOR_URL, {method:'post',contentType:'application/json; charset=utf-8',payload:body,headers:{'x-jddm-timestamp':stamp,'x-jddm-signature':signature},muteHttpExceptions:true});
    var result = JSON.parse(response.getContentText());
    if (response.getResponseCode() !== 200 || !result.ok) throw new Error('Calendar monitor could not complete (HTTP ' + response.getResponseCode() + '). Next check will retry.');
    PropertiesService.getScriptProperties().setProperty('JDDM_CALENDAR_MONITOR_LAST_SUCCESS',new Date().toISOString());
    console.log(JSON.stringify(result));
    return result;
  } finally { lock.releaseLock(); }
}

function installJddmCalendarChangeMonitor() {
  var result = runJddmCalendarChangeMonitor();
  if (!result) throw new Error('Calendar sync is busy; retry installation.');
  var existing = ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction() === 'runJddmCalendarChangeMonitor';});
  if (!existing.length) ScriptApp.newTrigger('runJddmCalendarChangeMonitor').timeBased().everyMinutes(5).create();
  console.log('Calendar change monitor installed: every 5 minutes. Existing events baselined without notifications.');
}
