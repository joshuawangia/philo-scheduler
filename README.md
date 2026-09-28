# Philo Interviews

Interview scheduler for the Philomathean Society.

- **Philos** connect their Google Calendar from Slack. The bot only reads when they are free or busy, never what their events say.
- **Applicants** open a plain page (black Garamond on white), see a list of open times, and click one. They never see who will interview them.
- The **First Censor** (the admin) can move, reassign, or cancel any interview and change the interview settings from the Slack app's Home tab.
- Sign-ups are **emailed to the First Censor in batches** (see [Sign-up emails](#sign-up-emails)).

## How it works

1. The First Censor sets the interview window: dates, daily hours (default 9am–11pm), interview length (default 2 hours), and how many philos sit on each interview (default 2).
2. The server checks every connected philo's free/busy times. A time appears on the applicant page only if enough philos are free for the whole interview.
3. When an applicant books, the bot picks the free philos who have done the fewest interviews so far. It creates a Google Calendar event that invites **only those philos** and sends each of them a Slack DM.
4. The applicant gets a confirmation page with "Add to Google Calendar" / `.ics` links and a private link they can use to cancel.

## Sign-up emails

New sign-ups, cancellations and moved interviews are emailed to `DIGEST_TO` (default `firstcensor@philomathean.org`), not posted in Slack.

- **Daily digest.** Every morning at `DIGEST_HOUR` (default 8am Eastern), the First Censor gets one email if anything changed since the last one. It lists the new sign-ups, the cancellations and moves, and the schedule for the next 48 hours, with a spreadsheet (CSV file) of every sign-up attached. If nothing changed, no email is sent.
- **Urgent email.** If a change affects an interview in the next `URGENT_WINDOW_HOURS` (default 24), everything pending is sent right away with `URGENT:` in the subject, because tomorrow morning would be too late.
- **Failed sends are retried.** A change counts as emailed only after the email actually goes out, so if a send fails, it's retried on the next check (every minute).

Mail is sent over SMTP. The easiest option is a Gmail account with an [app password](https://myaccount.google.com/apppasswords), a special password that lets an app send mail from that account (2-Step Verification must be on):

```
SMTP_URL=smtps://society.account%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465
EMAIL_FROM=Philo Interviews <society.account@gmail.com>
```

If `SMTP_URL` isn't set, emails are only printed in the server log and stay in the queue until mail is set up.

## Slack commands

| Command | Who | What |
|---|---|---|
| `/philo connect` | anyone | Connect Google Calendar |
| `/philo disconnect` | anyone | Stop being scheduled |
| `/philo list` | anyone | Your upcoming interviews (the First Censor sees all of them) |
| `/philo link` | anyone | Applicant sign-up link |
| `/philo settings` | First Censor | Dates, hours, length, philos per interview, location |
| `/philo open` / `close` | First Censor | Turn applicant sign-ups on or off |
| `/philo censor @someone` | First Censor | Hand the First Censor role to someone else |

The **Home tab** shows your calendar connection and your interviews. For the First Censor it also shows every interview, each with **Edit** (new time and/or different philos) and **Cancel** buttons.

## Setup

You need Node 22.13+ and three things: a Google OAuth client, a Slack app, and a public URL to host the server.

### 1. Google Cloud

1. Go to <https://console.cloud.google.com/>, create a project, and enable the **Google Calendar API**.
2. Under **OAuth consent screen**, choose *External* (or *Internal* if you're on a Google Workspace), and add the scopes `calendar.freebusy` and `calendar.events`. While the app is in *Testing* mode, add every philo's Gmail address as a test user.
3. Under **Credentials**, create an **OAuth client ID** of type *Web application*, with the redirect URI `https://YOUR_URL/oauth/google/callback`.

### 2. Slack

1. Go to <https://api.slack.com/apps>, click **Create New App**, then **From a manifest**, and paste `slack-manifest.yml` after putting your URL in it.
2. Install the app to the workspace. Copy the **Bot token** (`xoxb-…`) and the **Signing secret**.
3. Get the First Censor's member ID: open their Slack profile, click ⋯, then **Copy member ID**.

### 3. Run

```bash
cp .env.example .env    # fill it in
npm install
npm run dev             # or: npm start
```

Then, in Slack, the First Censor runs `/philo settings` to set the dates, and each philo runs `/philo connect`. Send applicants to your `BASE_URL`.

**Local development:** turn on Socket Mode in the Slack app and set `SLACK_APP_TOKEN=xapp-…`. Slack then talks to your laptop directly, so you don't need a public URL for it. Set `BASE_URL=http://localhost:3000` and add `http://localhost:3000/oauth/google/callback` as a Google redirect URI.

### Hosting

Any host that runs Node and has a persistent disk will work, for example Railway, Render, Fly.io, or a small VM. The data lives in a single SQLite file at `DB_PATH`, so mount a volume for it. A `Dockerfile` is included.

## Development

```bash
npm test
```

Code map: `src/digest.js` writes the sign-up email and `src/digest-runner.js` decides when to send it (`src/mailer.js` does the sending). `src/scheduler.js` builds slots, checks availability, and handles booking. `src/slack.js` has the bot, Home tab, and modals. `src/web.js` and `src/views.js` serve the applicant pages. `src/google.js` wraps the Calendar API. `src/db.js` holds the SQLite storage.

## Privacy notes

- Google refresh tokens are encrypted at rest with `SESSION_SECRET`.
- Philos grant free/busy access only, plus permission to create the interview events.
- Applicants are never added to the calendar event, and philos' names never appear on applicant pages.
