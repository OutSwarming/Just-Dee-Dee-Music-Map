/**
 * Just Dee Dee Music Gmail -> Discord bridge.
 *
 * One Gmail message becomes one Discord forum post. Discord forum tags provide
 * the shared triage state, while a Gmail label makes posted conversations easy
 * to recognize in the source mailbox.
 */

var JDDM_DISCORD_EMAIL_BRIDGE_VERSION = '2026-08-30-email-forum-v1';
var JDDM_EXPECTED_GMAIL_ACCOUNT = 'justdeedeemusic@gmail.com';
var JDDM_DEFAULT_GMAIL_QUERY = 'in:anywhere newer_than:30d -in:trash';
var JDDM_DEFAULT_MAX_THREADS = 50;
var JDDM_POSTED_LABEL = 'JDDM/Discord Posted';
var JDDM_ERROR_LABEL = 'JDDM/Discord Error';
var JDDM_PROPERTY_WEBHOOK = 'DISCORD_EMAIL_WEBHOOK_URL';
var JDDM_PROPERTY_TAGS = 'DISCORD_EMAIL_TAGS_JSON';
var JDDM_PROPERTY_QUERY = 'DISCORD_EMAIL_GMAIL_QUERY';
var JDDM_PROPERTY_MAX_THREADS = 'DISCORD_EMAIL_MAX_THREADS';
var JDDM_PROPERTY_LAST_SUCCESS = 'DISCORD_EMAIL_LAST_SUCCESS_AT';
var JDDM_PROPERTY_LAST_ERROR = 'DISCORD_EMAIL_LAST_ERROR';

/**
 * Save the private Discord webhook and the forum tag IDs.
 * Run only in the Just Dee Dee Gmail account's Apps Script project.
 */
function configureDiscordEmailBridge(webhookUrl, tagIdsByName, options) {
  var url = String(webhookUrl || '').trim();
  if (!/^https:\/\/(?:canary\.|ptb\.)?(?:discord(?:app)?\.com)\/api\/webhooks\//i.test(url)) {
    throw new Error('A valid Discord webhook URL is required.');
  }

  var normalizedTags = normalizeTagMap_(tagIdsByName || {});
  if (!normalizedTags.important || !normalizedTags.spam || !normalizedTags.booking ||
      !normalizedTags['action-needed'] || !normalizedTags['google-voice']) {
    throw new Error('Tag IDs are required for important, spam, booking, action-needed, and google-voice.');
  }

  var settings = options || {};
  var properties = PropertiesService.getScriptProperties();
  properties.setProperty(JDDM_PROPERTY_WEBHOOK, url);
  properties.setProperty(JDDM_PROPERTY_TAGS, JSON.stringify(normalizedTags));
  properties.setProperty(
    JDDM_PROPERTY_QUERY,
    String(settings.gmailQuery || JDDM_DEFAULT_GMAIL_QUERY).trim()
  );
  properties.setProperty(
    JDDM_PROPERTY_MAX_THREADS,
    String(clampInteger_(settings.maxThreads || JDDM_DEFAULT_MAX_THREADS, 1, 100))
  );
  return getDiscordEmailBridgeHealth();
}

/** Authorize Gmail, verify the account, and make the visible source label. */
function authorizeDiscordEmailBridge() {
  assertExpectedMailbox_();
  getOrCreateGmailLabel_(JDDM_POSTED_LABEL);
  getOrCreateGmailLabel_(JDDM_ERROR_LABEL);
  GmailApp.getInboxThreads(0, 1);
  return getDiscordEmailBridgeHealth();
}

/** Install a five-minute intake trigger. This is email delivery, not app monitoring. */
function installDiscordEmailBridge() {
  assertExpectedMailbox_();
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncJddmEmailToDiscord') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('syncJddmEmailToDiscord').timeBased().everyMinutes(5).create();
  return { ok: true, handler: 'syncJddmEmailToDiscord', everyMinutes: 5 };
}

/** Remove only this bridge's intake trigger. */
function uninstallDiscordEmailBridgeTrigger() {
  var deleted = 0;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncJddmEmailToDiscord') {
      ScriptApp.deleteTrigger(triggers[i]);
      deleted += 1;
    }
  }
  return { ok: true, deleted: deleted };
}

/**
 * Poll Gmail and create one Discord forum post for each unposted message.
 * Failed messages are left unprocessed so the next run can retry them.
 */
function syncJddmEmailToDiscord() {
  assertExpectedMailbox_();
  var properties = PropertiesService.getScriptProperties();
  var webhookUrl = String(properties.getProperty(JDDM_PROPERTY_WEBHOOK) || '').trim();
  if (!webhookUrl) throw new Error('Discord webhook is not configured.');

  var tagMap = parseTagMap_(properties.getProperty(JDDM_PROPERTY_TAGS));
  var query = String(properties.getProperty(JDDM_PROPERTY_QUERY) || JDDM_DEFAULT_GMAIL_QUERY);
  var maxThreads = clampInteger_(
    properties.getProperty(JDDM_PROPERTY_MAX_THREADS) || JDDM_DEFAULT_MAX_THREADS,
    1,
    100
  );
  var postedLabel = getOrCreateGmailLabel_(JDDM_POSTED_LABEL);
  var errorLabel = getOrCreateGmailLabel_(JDDM_ERROR_LABEL);
  var threads = GmailApp.search(query, 0, maxThreads);
  var pending = [];

  for (var threadIndex = 0; threadIndex < threads.length; threadIndex++) {
    var thread = threads[threadIndex];
    var messages = thread.getMessages();
    for (var messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      var message = messages[messageIndex];
      if (isMessageProcessed_(message)) continue;
      pending.push({ thread: thread, message: message });
    }
  }

  pending.sort(function(a, b) {
    return a.message.getDate().getTime() - b.message.getDate().getTime();
  });

  var result = { ok: true, scannedThreads: threads.length, pending: pending.length, posted: 0, failed: 0 };
  var errors = [];
  for (var itemIndex = 0; itemIndex < pending.length; itemIndex++) {
    var item = pending[itemIndex];
    try {
      var record = readMessageRecord_(item.message, item.thread);
      var classification = classifyMessage_(record);
      var payload = buildDiscordForumPayload_(record, classification, tagMap);
      postToDiscord_(webhookUrl, payload);
      markMessageProcessed_(item.message);
      item.thread.addLabel(postedLabel);
      item.thread.removeLabel(errorLabel);
      result.posted += 1;
    } catch (error) {
      result.failed += 1;
      item.thread.addLabel(errorLabel);
      errors.push(String(error && error.message ? error.message : error));
    }
  }

  var nowIso = new Date().toISOString();
  if (errors.length) {
    result.ok = false;
    result.errors = errors.slice(0, 10);
    properties.setProperty(JDDM_PROPERTY_LAST_ERROR, nowIso + ' ' + errors[0]);
  } else {
    properties.setProperty(JDDM_PROPERTY_LAST_SUCCESS, nowIso);
    properties.deleteProperty(JDDM_PROPERTY_LAST_ERROR);
  }
  return result;
}

/** Send a harmless synthetic message to verify Discord routing without reading Gmail. */
function testDiscordEmailBridge() {
  assertExpectedMailbox_();
  var properties = PropertiesService.getScriptProperties();
  var webhookUrl = String(properties.getProperty(JDDM_PROPERTY_WEBHOOK) || '').trim();
  var tagMap = parseTagMap_(properties.getProperty(JDDM_PROPERTY_TAGS));
  if (!webhookUrl) throw new Error('Discord webhook is not configured.');
  var record = {
    id: 'synthetic-' + new Date().getTime(),
    threadId: '',
    date: new Date(),
    from: 'Just Dee Dee Bridge Test <justdeedeemusic@gmail.com>',
    to: JDDM_EXPECTED_GMAIL_ACCOUNT,
    cc: '',
    subject: 'Bridge test — no customer email was used',
    body: 'This is a synthetic routing test. If you can read this in Discord, the email intake path is working.',
    starred: true,
    important: true,
    spam: false,
    labelNames: []
  };
  var classification = { tags: ['important'], reasons: ['Synthetic bridge test'] };
  var response = postToDiscord_(webhookUrl, buildDiscordForumPayload_(record, classification, tagMap));
  return { ok: true, responseCode: response.getResponseCode() };
}

function getDiscordEmailBridgeHealth() {
  var properties = PropertiesService.getScriptProperties();
  var tagMap = parseTagMap_(properties.getProperty(JDDM_PROPERTY_TAGS));
  return {
    ok: true,
    version: JDDM_DISCORD_EMAIL_BRIDGE_VERSION,
    expectedGmailAccount: JDDM_EXPECTED_GMAIL_ACCOUNT,
    activeGmailAccount: getActiveMailbox_(),
    webhookConfigured: Boolean(properties.getProperty(JDDM_PROPERTY_WEBHOOK)),
    configuredTags: Object.keys(tagMap).sort(),
    gmailQuery: properties.getProperty(JDDM_PROPERTY_QUERY) || JDDM_DEFAULT_GMAIL_QUERY,
    maxThreads: Number(properties.getProperty(JDDM_PROPERTY_MAX_THREADS) || JDDM_DEFAULT_MAX_THREADS),
    lastSuccessAt: properties.getProperty(JDDM_PROPERTY_LAST_SUCCESS) || '',
    lastError: properties.getProperty(JDDM_PROPERTY_LAST_ERROR) || ''
  };
}

function readMessageRecord_(message, thread) {
  var labelNames = [];
  var labels = thread.getLabels ? thread.getLabels() : [];
  for (var i = 0; i < labels.length; i++) labelNames.push(String(labels[i].getName()));
  return {
    id: String(message.getId()),
    threadId: thread.getId ? String(thread.getId()) : '',
    date: message.getDate(),
    from: String(message.getFrom() || ''),
    to: String(message.getTo() || ''),
    cc: String(message.getCc ? message.getCc() || '' : ''),
    subject: String(message.getSubject() || '(no subject)'),
    body: cleanEmailBody_(message.getPlainBody ? message.getPlainBody() : ''),
    starred: Boolean(message.isStarred && message.isStarred()),
    important: Boolean(thread.isImportant && thread.isImportant()),
    spam: Boolean(thread.isInSpam && thread.isInSpam()),
    labelNames: labelNames
  };
}

function classifyMessage_(record) {
  var subject = String(record.subject || '').toLowerCase();
  var from = String(record.from || '').toLowerCase();
  var body = String(record.body || '').toLowerCase().slice(0, 8000);
  var labels = (record.labelNames || []).map(function(value) { return String(value).toLowerCase(); });
  var haystack = subject + '\n' + from + '\n' + body;
  var tags = [];
  var reasons = [];

  var isVoice = /voice-noreply@google\.com/.test(from) ||
    /new (text message|voicemail)|missed call|google voice/.test(subject);
  var isSpam = Boolean(record.spam) || labels.indexOf('spam') >= 0 ||
    /\b(crypto investment|guaranteed loan|advance fee|wire funds|gift card payment)\b/.test(haystack);
  var isReceipt = /\b(receipt|invoice|payment received|paid|billing statement|order confirmation)\b/.test(haystack);
  var isBooking = /\b(book(?:ing|ed)?|gig|performance|play (?:at|on|our)|live music|availability|available date|venue|winery|brewery|show date|entertainment)\b/.test(haystack);
  var isNewsletter = /\b(unsubscribe|newsletter|mailing list|view in browser|promotional)\b/.test(haystack);
  var isImportant = Boolean(record.starred || record.important) || labels.indexOf('important') >= 0 ||
    /\b(urgent|time[- ]sensitive|asap|contract|cancellation|cancelled|confirmed)\b/.test(haystack);
  var needsAction = isBooking || isVoice || /\?|\b(please reply|please confirm|let me know|need your|can you|could you|would you|action required)\b/.test(haystack);

  if (isSpam) { tags.push('spam'); reasons.push('Spam signal'); }
  if (isImportant && !isSpam) { tags.push('important'); reasons.push('Important or starred'); }
  if (isBooking && !isSpam) { tags.push('booking'); reasons.push('Booking or venue language'); }
  if (needsAction && !isSpam) { tags.push('action-needed'); reasons.push('Reply or action appears needed'); }
  if (isReceipt && !isSpam) { tags.push('receipt'); reasons.push('Receipt, invoice, or payment'); }
  if (isNewsletter && !isSpam) { tags.push('newsletter'); reasons.push('Newsletter or promotion'); }
  if (isVoice && !isSpam) { tags.push('google-voice'); reasons.push('Google Voice notification'); }
  if (!tags.length) { tags.push('general'); reasons.push('General email'); }

  return { tags: uniqueStrings_(tags), reasons: reasons };
}

function buildDiscordForumPayload_(record, classification, tagMap) {
  var sender = extractSenderName_(record.from) || record.from || 'Unknown sender';
  var subject = cleanOneLine_(record.subject || '(no subject)');
  var tagNames = classification.tags || [];
  var appliedTags = [];
  for (var i = 0; i < tagNames.length; i++) {
    var tagId = tagMap[normalizeTagName_(tagNames[i])];
    if (tagId && appliedTags.indexOf(tagId) < 0) appliedTags.push(tagId);
  }
  var dateText = record.date instanceof Date ? record.date.toISOString() : String(record.date || '');
  var gmailUrl = record.threadId ? 'https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(record.threadId) : '';
  var fields = [
    { name: 'From', value: truncate_(cleanOneLine_(record.from || 'Unknown'), 1024), inline: false },
    { name: 'To', value: truncate_(cleanOneLine_(record.to || JDDM_EXPECTED_GMAIL_ACCOUNT), 1024), inline: false },
    { name: 'Tags', value: tagNames.join(', ') || 'general', inline: true }
  ];
  if (record.cc) fields.push({ name: 'CC', value: truncate_(cleanOneLine_(record.cc), 1024), inline: false });
  if (gmailUrl) fields.push({ name: 'Open in Gmail', value: '[Open original conversation](' + gmailUrl + ')', inline: false });
  return {
    thread_name: truncate_(sender + ' — ' + subject, 100),
    applied_tags: appliedTags,
    allowed_mentions: { parse: [] },
    username: 'Just Dee Dee Email',
    embeds: [{
      title: truncate_(subject, 256),
      description: truncate_(record.body || '_No plain-text message body._', 3900),
      color: colorForTags_(tagNames),
      fields: fields,
      timestamp: dateText || new Date().toISOString(),
      footer: { text: 'Gmail message ' + truncate_(record.id || 'unknown', 120) }
    }]
  };
}

function postToDiscord_(webhookUrl, payload) {
  var separator = webhookUrl.indexOf('?') >= 0 ? '&' : '?';
  var response = UrlFetchApp.fetch(webhookUrl + separator + 'wait=true', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var responseCode = response.getResponseCode();
  if (responseCode < 200 || responseCode >= 300) {
    throw new Error('Discord returned HTTP ' + responseCode + ': ' + truncate_(response.getContentText(), 500));
  }
  return response;
}

function getActiveMailbox_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').toLowerCase();
  } catch (error) {
    return '';
  }
}

function assertExpectedMailbox_() {
  var active = getActiveMailbox_();
  if (active && active !== JDDM_EXPECTED_GMAIL_ACCOUNT) {
    throw new Error(
      'Wrong Gmail account. Expected ' + JDDM_EXPECTED_GMAIL_ACCOUNT + ' but this script is running as ' + active + '.'
    );
  }
}

function getOrCreateGmailLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function processedBucketKey_(message) {
  return 'POSTED_' + Utilities.formatDate(message.getDate(), 'UTC', 'yyyy_MM');
}

function isMessageProcessed_(message) {
  var value = PropertiesService.getScriptProperties().getProperty(processedBucketKey_(message)) || '';
  return ('\n' + value + '\n').indexOf('\n' + String(message.getId()) + '\n') >= 0;
}

function markMessageProcessed_(message) {
  var properties = PropertiesService.getScriptProperties();
  var key = processedBucketKey_(message);
  var value = properties.getProperty(key) || '';
  var ids = value ? value.split('\n').filter(Boolean) : [];
  var messageId = String(message.getId());
  if (ids.indexOf(messageId) < 0) ids.push(messageId);
  if (ids.length > 450) ids = ids.slice(ids.length - 450);
  properties.setProperty(key, ids.join('\n'));
}

function parseTagMap_(json) {
  if (!json) return {};
  try {
    return normalizeTagMap_(JSON.parse(json));
  } catch (error) {
    throw new Error('Discord tag configuration is invalid JSON.');
  }
}

function normalizeTagMap_(value) {
  var output = {};
  Object.keys(value || {}).forEach(function(key) {
    var normalized = normalizeTagName_(key);
    var id = String(value[key] || '').trim();
    if (normalized && /^\d{10,30}$/.test(id)) output[normalized] = id;
  });
  return output;
}

function normalizeTagName_(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function cleanEmailBody_(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function cleanOneLine_(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function extractSenderName_(fromValue) {
  var text = cleanOneLine_(fromValue);
  var match = text.match(/^\s*"?([^"<]+?)"?\s*</);
  return match ? match[1].trim() : text.replace(/<[^>]+>/g, '').trim();
}

function truncate_(value, maxLength) {
  var text = String(value || '');
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

function uniqueStrings_(values) {
  var output = [];
  for (var i = 0; i < values.length; i++) if (output.indexOf(values[i]) < 0) output.push(values[i]);
  return output;
}

function colorForTags_(tags) {
  if (tags.indexOf('spam') >= 0) return 0x747f8d;
  if (tags.indexOf('important') >= 0) return 0xed4245;
  if (tags.indexOf('booking') >= 0) return 0x57f287;
  if (tags.indexOf('google-voice') >= 0) return 0x5865f2;
  if (tags.indexOf('receipt') >= 0) return 0xfee75c;
  return 0x3498db;
}

function clampInteger_(value, minimum, maximum) {
  var number = Math.round(Number(value));
  if (!isFinite(number)) number = minimum;
  return Math.max(minimum, Math.min(maximum, number));
}
