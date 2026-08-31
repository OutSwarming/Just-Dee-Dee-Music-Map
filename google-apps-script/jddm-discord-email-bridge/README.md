# Just Dee Dee Gmail to Discord

This standalone Apps Script runs as `justdeedeemusic@gmail.com`. Every unposted
Gmail message from the configured 30-day search window becomes one post in the
private Discord `email-inbox` forum. Discord forum tags provide triage without
duplicating the same email across many channels.

Required forum tags:

- `Important`
- `Booking`
- `Action Needed`
- `Receipt`
- `Newsletter`
- `Spam`
- `Google Voice`
- `General`
- `Done` (manual workflow tag; the bridge never adds it automatically)

The webhook URL is stored in Apps Script Script Properties, never in source
control. The bridge refuses to run from any visibly different Gmail account.

Deployment order:

1. Create the private Discord forum and its tags.
2. Create a webhook for that forum.
3. Create a standalone Apps Script while signed in as `justdeedeemusic@gmail.com`.
4. Copy `Code.gs` and `appsscript.json` into that project.
5. Run `configureDiscordEmailBridge(webhookUrl, tagMap)` once.
6. Run `authorizeDiscordEmailBridge()` and approve Gmail access.
7. Run `testDiscordEmailBridge()` and verify the synthetic post.
8. Run `syncJddmEmailToDiscord()` and verify one real email.
9. Run `installDiscordEmailBridge()` to poll every five minutes.

Google Voice can use the same route: turn on Voice's email forwarding for
messages, missed calls, and voicemail. The classifier applies the `Google Voice`
and `Action Needed` tags to those notification emails.
