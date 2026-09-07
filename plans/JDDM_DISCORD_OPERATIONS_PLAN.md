# Just Dee Dee Music Discord Operations Plan

## Outcome

Use one private Discord server as the daily Just Dee Dee Music workspace. Email
and Google Voice notifications arrive as searchable forum posts with visible
triage tags. The music-map application's technical monitoring stays out of this
server for now.

## Server layout

### 📌 START HERE

- `read-me-first`: short instructions and the meaning of each tag.
- `announcements`: durable decisions and important changes.

### 📥 INBOXES

- `email-inbox` (forum): one post per Gmail message.
- `voice-inbox` (forum or text channel): reserved for any Voice items that need
  a separate view later. At launch, Voice notifications enter `email-inbox`
  with the `Google Voice` tag so there is only one action queue.

Forum tags: `Important`, `Booking`, `Action Needed`, `Receipt`, `Newsletter`,
`Spam`, `Google Voice`, `General`, and `Done`.

### 🎵 BOOKINGS

- `booking-pipeline`: decisions and status discussion for possible gigs.
- `calendar-and-gigs`: confirmed dates, changes, and cancellations.
- `venues-and-contacts`: useful venue/contact notes that should not be buried
  in an email thread.

### 💬 TEAM

- `general-team-chat`: normal team conversation.
- `ideas-and-planning`: future improvements and non-urgent ideas.

## Email workflow

1. Gmail remains the source of truth and retains the original message.
2. Every new message becomes one Discord forum post, never several duplicate
   channel messages.
3. Automatic tags make the first pass; humans can correct tags and add `Done`.
   In bot mode, each post also has **Reply / Mark Spam / Archive / Done** buttons
   that act on the Gmail message directly (see
   `docs/JDDM_DISCORD_EMAIL_BOT_SETUP.md`). Replying from Discord sends a genuine
   threaded email from `justdeedeemusic@gmail.com`.
4. Discord mentions are disabled in imported email bodies so an email cannot
   trigger `@everyone` or role pings.
5. Attachments stay in Gmail at launch. Discord shows a Gmail link and the email
   preview; this avoids copying sensitive or very large files without review.
6. A failed Discord post is labeled `JDDM/Discord Error` in Gmail and retried on
   the next run. A successful post gets `JDDM/Discord Posted`.
7. The first live run uses a synthetic test, then one real message, then a
   controlled 30-day backfill. It does not dump years of old mail into Discord.

## Google Voice workflow

Google Voice can forward text-message notifications, missed-call alerts, and
voicemail messages to Gmail. Turn those three settings on in the Just Dee Dee
Voice account. The same Gmail bridge recognizes Google's Voice notification
sender/subjects and applies `Google Voice` plus `Action Needed`; booking language
also receives the `Booking` tag.

This approach keeps the original conversation in Google Voice. Replies should
be sent from Google Voice, not Discord, because Voice is intended for interactive
messaging and Discord does not provide a supported way to reply through a
consumer Voice number.

## Launch checks

- Synthetic Discord post lands in `email-inbox` with the correct tag.
- A real booking email arrives once, links back to Gmail, and is not duplicated.
- A receipt is tagged `Receipt`; a Gmail spam item is tagged only `Spam`.
- A Google Voice text notification is tagged `Google Voice` and `Action Needed`.
- A forced Discord error is retried, then changes from the error label to the
  posted label after success.
- The bridge refuses to run under Carter's personal Gmail account.
