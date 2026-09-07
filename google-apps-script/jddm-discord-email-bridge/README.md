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

## Action buttons (bot mode)

Each post can carry **Reply / Mark Spam / Archive / Done** buttons that act on the
real Gmail message. This requires a Discord **bot** (a plain webhook cannot carry
interactive buttons) plus the `discordEmailInteractions` Cloud Function to handle
clicks. Full runbook: [`docs/JDDM_DISCORD_EMAIL_BOT_SETUP.md`](../../docs/JDDM_DISCORD_EMAIL_BOT_SETUP.md).

Short version once the Discord bot + Gmail OAuth are provisioned:

1. Deploy the function: `firebase deploy --only functions:discordEmailInteractions`.
2. Set the function URL as the app's **Interactions Endpoint URL** in the Discord
   Developer Portal.
3. In this Apps Script, run once:
   `configureDiscordEmailBotBridge(botToken, forumChannelId)`.
   Forum tag IDs are auto-discovered by name, so no tag map is needed. Bot mode then
   takes priority over the webhook automatically; buttons appear on every new post.
   `configureDiscordEmailBridge(webhookUrl, tagMap)` still works for plain webhook
   (no-button) mode.
