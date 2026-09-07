# Just Dee Dee Music — Discord Email Action Bot Setup

This turns the existing Gmail→Discord bridge into an **action inbox**: every email
still becomes one forum post in `email-inbox`, but now each post carries four
buttons — **✉️ Reply**, **🚫 Mark Spam**, **🗂️ Archive**, **✅ Done** — that act on
the real Gmail message. Reply opens a box in Discord and sends a genuine threaded
reply from `justdeedeemusic@gmail.com`.

## How it works (two pieces)

1. **Intake** — the Apps Script (`google-apps-script/jddm-discord-email-bridge/Code.gs`)
   polls Gmail every 5 minutes and posts each new email as a forum post **with the
   buttons attached**. It posts as your Discord **bot** (a plain webhook cannot carry
   action buttons).
2. **Actions** — a Firebase Cloud Function (`discordEmailInteractions`) receives each
   button click, verifies Discord's signature, and calls the Gmail API to reply /
   spam / archive / mark done, then edits the post to show what happened.

Because buttons act on Gmail, two things must be provisioned that only you can do:
a **Discord bot** and a **one-time Gmail authorization**. Everything else is code
that's already written and tested.

---

## Part A — Discord application + bot

1. Go to <https://discord.com/developers/applications> → **New Application** →
   name it "Just Dee Dee Email".
2. **General Information** tab → copy the **Application ID** and the **Public Key**.
   (You'll need the Public Key for the Cloud Function.)
3. **Bot** tab → **Reset Token** → copy the **Bot Token**. Keep it secret.
   - Privileged intents: none needed. Leave them off.
4. **Installation / OAuth2** → generate an invite URL with scope `bot` and these
   permissions, then open it to add the bot to the Just Dee Dee server:
   *View Channels, Send Messages, Send Messages in Threads, Create Public Threads,
   Manage Threads, Embed Links.*
5. In Discord, enable **Developer Mode** (User Settings → Advanced), then right-click
   the **`email-inbox` forum channel → Copy Channel ID**.
6. Get each **forum tag ID**: right-click the channel → Edit Channel → Tags, or use
   the same tag-ID list you already configured for the webhook. You need IDs for at
   least: `important`, `spam`, `booking`, `action-needed`, `google-voice` (and
   ideally `receipt`, `newsletter`, `general`).

You will set the **Interactions Endpoint URL** (step D-4) after the function is
deployed.

---

## Part B — Gmail authorization (mint a refresh token)

The Cloud Function acts on Gmail through an OAuth refresh token for the JDDM mailbox.

1. In **Google Cloud Console** (the `just-dee-dee-music-map` project):
   - **APIs & Services → Library → Gmail API → Enable** (already enabled here).
   - **OAuth consent screen (Google Auth Platform → Audience)**: keep it **External**
     and **"In production"**. Do **not** switch it to "Testing" — production refresh
     tokens persist, while Testing-mode tokens expire after ~7 days and would break
     the bot. In production no Test user needs to be added.
   - **Credentials → Create credentials → OAuth client ID → Application type: Desktop
     app.** Copy the **Client ID** and **Client secret**.
   - Because this app is unverified and Gmail scopes are sensitive/restricted, the
     consent screen (next step) shows a **"Google hasn't verified this app"** warning
     — click **Advanced → Go to <app> (unsafe) → Allow**. This is expected for a
     personal script accessing its own mailbox.
2. From the repo root, run the helper, pointing it at the client JSON you
   downloaded (it opens a local loopback — no secret on the command line):

   ```bash
   npm run jddm:gmail-oauth -- /path/to/client_secret_XXXX.json
   ```

   Open the printed URL **signed in as `justdeedeemusic@gmail.com`**, click through
   the "unverified app" warning (Advanced → Go to app), approve the Gmail
   permissions, and the script prints a **refresh token**.

---

## Part C — Firebase secrets + deploy

Set these secrets (you'll be prompted to paste each value):

```bash
firebase functions:secrets:set DISCORD_EMAIL_PUBLIC_KEY     # Discord app Public Key
firebase functions:secrets:set JDDM_GMAIL_CLIENT_ID         # OAuth client id
firebase functions:secrets:set JDDM_GMAIL_CLIENT_SECRET     # OAuth client secret
firebase functions:secrets:set JDDM_GMAIL_REFRESH_TOKEN     # from Part B
```

Deploy the interaction handler and the intake transport:

```bash
firebase deploy --only functions:discordEmailInteractions,functions:discordEmailIntake
```

Copy the deployed **function URL** from the output (looks like
`https://us-central1-<project>.cloudfunctions.net/discordEmailInteractions`).

> Reliability note: the function performs the Gmail action first, then responds by
> editing the post — so a click never silently no-ops. On a rare cold start (the
> whole round trip exceeding Discord's 3-second window), Discord may show
> "interaction failed" even though the Gmail action already completed; just refresh
> the channel to see the real state. If that ever becomes annoying for this
> low-volume inbox, add `minInstances: 1` to the function's `.runWith({...})` to keep
> one instance warm (small always-on cost). The only edge case worth knowing: if a
> **Reply** shows "failed" and you re-click and resend, the recipient could get the
> message twice — check the Gmail thread before resending.

---

## Part D — Point Discord at the function, then switch intake to bot mode

The Apps Script bot requests use `discordEmailIntake` in this Firebase project.
Discord rejects Apps Script's default client identification with HTTP 403 / code
40333 (`internal network error`), which is different from missing channel access.
The Firebase transport supplies Discord's documented bot User-Agent. It accepts
only forum metadata reads and post creation for channel `1543777722042679436` and
passes the JDDM bot credential to Discord for authentication without storing it.
Explicit short rate limits are retried; ambiguous network failures are not.

For setup through the Apps Script Run menu, first save `DISCORD_EMAIL_BOT_TOKEN`
and `DISCORD_EMAIL_CHANNEL_ID` as Script Properties, then run `startJddmEmail`.
It discovers the tags, installs the five-minute trigger, and forwards recent email.
Each poll posts up to 20 messages with the newest arrivals first. A Discord rate
limit leaves the remaining messages queued for a later poll. No Apps Script web-app deployment is needed.

1. Back in the Discord Developer Portal → your app → **General Information** →
   **Interactions Endpoint URL** → paste the function URL from Part C → **Save**.
   Discord sends a signed PING; the function answers it. If it saves without an
   error, signature verification is working.
2. Open the Apps Script project (bound to `justdeedeemusic@gmail.com`) that already
   runs `Code.gs`. Paste the updated `Code.gs` from this repo over the old one.
3. In the Apps Script editor, run **once** (Run → select function). Tag IDs are
   discovered automatically from the forum by name, so you only pass the bot token
   and the `email-inbox` channel ID:

   ```js
   configureDiscordEmailBotBridge('PASTE_BOT_TOKEN', 'PASTE_email-inbox_CHANNEL_ID');
   ```

   (Bot mode takes priority over the old webhook automatically. If the forum is
   missing a required tag, the function tells you exactly which one to create.)
4. Run `testDiscordEmailBridge()` — a synthetic post with the four buttons should
   appear in `email-inbox`.
5. The existing 5-minute trigger keeps running. If you never installed it, run
   `installDiscordEmailBridge()`.

---

## Verify end-to-end

- `getDiscordEmailBridgeHealth()` in Apps Script shows `botConfigured: true`,
  `actionButtons: true`, and your `channelId`.
- Send a test email into the JDDM inbox. Within ~5 min a post appears with buttons.
- **✅ Done** → post updates to "Marked done"; the Gmail message leaves the inbox.
- **🗂️ Archive** → Gmail message is archived; buttons stay for further action.
- **🚫 Mark Spam** → Gmail message moves to Spam; buttons are removed.
- **✉️ Reply** → a box opens; your text is sent as a real threaded reply, and the
  post shows "Replied by <you> → <recipient>".

## Scope

Intake stays on the **30-day** rolling window (`in:anywhere newer_than:30d -in:trash`,
50 conversations checked per run, up to 20 messages posted per run). Individual
messages older than 30 days are skipped even inside a recent conversation.
Large backlogs take additional polls. To change
that later, pass `{ gmailQuery: '...' }` as the 4th argument to
`configureDiscordEmailBotBridge`.

## Security notes

- The bot token, Gmail client secret, and refresh token live only in Discord's
  portal, Apps Script Script Properties, and Firebase Secrets — never in source.
- The function rejects any request whose Ed25519 signature does not verify against
  `DISCORD_EMAIL_PUBLIC_KEY`, so only genuine Discord interactions can act on Gmail.
- The Apps Script still refuses to run under any account other than
  `justdeedeemusic@gmail.com`.

## Spreadsheet notification deployment

The map's spreadsheet endpoint runs in **barkrangermap-auth**, not the email
function's Firebase project. Set `DISCORD_NEW_PLACES_WEBHOOK_URL` and
`DISCORD_FOLLOWUP_WEBHOOK_URL` in that project and deploy only
`functions:jddmSpreadsheetBridge`. New-place alerts go to `#new-places`;
new and changed nonempty follow-up dates go to `#follow-up`. Saving an unchanged
date does not post another alert. Direct Google Sheets edits bypass this service.
