/** Calendar decisions are stored privately in Firestore, never in extra sheet columns. */
function jddmCalendarReviewKey_(event) {
  function normalize(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  var input = JSON.stringify([normalize(event.venueName || normalizeCalendarVenueName_(event.title)), normalize(event.location)]);
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8).map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('').slice(0,32);
}
function resolveCalendarVenueEvents_(events) {
  var key = PropertiesService.getScriptProperties().getProperty('JDDM_CALENDAR_MONITOR_KEY');
  if (!key) throw new Error('Calendar review key is missing. Automatic venue creation is disabled.');
  var body = JSON.stringify({source:'calendar',enqueue:false,events:events});
  var stamp = String(Date.now());
  var signature = Utilities.computeHmacSha256Signature(stamp + '.' + body, key, Utilities.Charset.UTF_8).map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  var response = UrlFetchApp.fetch('https://us-central1-just-dee-dee-music-map.cloudfunctions.net/jddmCalendarVenueReview', {
    method:'post',contentType:'application/json',payload:body,muteHttpExceptions:true,
    headers:{'x-jddm-timestamp':stamp,'x-jddm-signature':signature}
  });
  var result = JSON.parse(response.getContentText());
  if (response.getResponseCode() !== 200 || !result.ok || !result.mappings) throw new Error('Calendar review is unavailable. No new spreadsheet venues were created.');
  return result.mappings;
}
