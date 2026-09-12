# Daily follow-ups and local recap

The official spreadsheet’s current `Next Follow Up` is authoritative. A linked email’s saved copy, old notification post, or cached morning body cannot override a changed or cleared spreadsheet date.

The 8 AM Eastern daily follow-up notification and its texts show dates scheduled **today**, followed by **the next two calendar days**. Old venue dates, unlinked email dates, and suggested booking timers do not roll into today’s agenda. Booking contact problems and the persistent four-venue information worklist remain separate sections.

The 8:05 AM local AI recap uses the same window. It calculates its list, linked-email dates, and metrics from one current spreadsheet snapshot. Follow-ups “remaining this week” exclude days already passed. The morning recap does not display overdue counts or recommend the overdue backlog; the renderer rejects explicit overdue recommendations even if the model produces them. Historical reminder posts are not fed back as current tasks. A failed live spreadsheet read blocks generation rather than substituting stale dates.

Actual past dates remain saved and can still be classified as overdue in tracking. **A past follow-up date is not evidence that a pin’s contacts have not been edited.** Contact information updates and completing/rescheduling a follow-up are different events. Do not claim no work was done from the date alone. Do not clear or advance official dates merely to make a reminder disappear.

Each digest request rereads current inputs. The stored digest is a result, not a day-long authority. Delivery receipts still prevent duplicate messages and preserve partial-send recovery. An already delivered message is historical; it cannot change a text already received. AI preparation at 6 AM, refresh at 7:45 AM, and a final source check at delivery remain enabled.

Run `npm run test:notifications`, `npm test --prefix functions`, and the project-isolation checks. Tests cover old, today, horizon and later dates; Eastern/DST boundaries; moved/cleared dates after a cached read; stale linked conversations; real backlog preservation; missing live data; AI output filtering; and partial delivery retries. Use local `--preview` and text `--dry-run` modes for production-data verification without sending messages.

Cloud releases must follow `FIREBASE_PROJECT_OWNERSHIP.md` and patch only the reviewed `followUpDigest.js` into each deployed function’s own source archive. Local recap files run directly from the configured checkout. Never deploy the entire historical local index as a shortcut.
