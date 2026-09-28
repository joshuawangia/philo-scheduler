<p align="center"><img src="public/logo.jpg" alt="The Philomathean Society" width="420"></p>

# Philo Interviews

An interview scheduler for the Philomathean Society.

- **Philos** (members) connect their Google Calendar from Slack. The app only reads whether they are free or busy, never what their events say.
- **Applicants** open a plain page (black Garamond on white), pick a time from the list of open ones, and they're booked. They never see who will interview them.
- **The First Censor** (the admin) gets every sign-up by email in a daily digest, and can move, reassign, or cancel any interview from Slack.

> **Setting this up for the first time?** Skip to [Setup guide](#setup-guide). It takes about 45 minutes and doesn't require writing any code. If you'd like an AI assistant to walk you through it, use the [AI setup prompt](#set-it-up-with-an-ai-assistant).

---

## Contents

- [How it works](#how-it-works)
- [Setup guide](#setup-guide)
  - [What you need](#what-you-need)
  - [Step 1: Put the app online (Railway)](#step-1-put-the-app-online-railway)
  - [Step 2: Google Calendar access](#step-2-google-calendar-access)
  - [Step 3: The Slack app](#step-3-the-slack-app)
  - [Step 4: The email account for digests](#step-4-the-email-account-for-digests)
  - [Step 5: Fill in the settings](#step-5-fill-in-the-settings)
  - [Step 6: First run](#step-6-first-run)
- [Set it up with an AI assistant](#set-it-up-with-an-ai-assistant)
- [Using it](#using-it)
- [All settings](#all-settings)
- [Troubleshooting](#troubleshooting)
- [For developers](#for-developers)
- [Privacy](#privacy)

---

## How it works

1. The First Censor picks the interview dates in Slack. By default interviews are **2 hours**, start **every hour**, and must fit **between 9am and 11pm**, with **2 philos** per interview.
2. The app checks every connected philo's Google Calendar. A time appears on the applicant page only if enough philos are free for the whole interview.
3. When an applicant picks a time, the app assigns the free philos who have done the fewest interviews so far, puts the interview on their Google Calendars, and sends each of them a Slack message.
4. The applicant sees a confirmation page with "Add to Google Calendar" and a private link to cancel.
5. The First Censor gets the sign-ups by email:
   - **One digest each morning at 8am**, only if something changed. It lists new sign-ups, cancellations, moved interviews, and the next 48 hours, with a spreadsheet of everyone attached.
   - **An urgent email right away** if a change affects an interview in the next 24 hours.

---

## Setup guide

### What you need

| Thing | Why | Cost |
|---|---|---|
| A **GitHub** account | To copy this code | Free |
| A **Railway** account ([railway.com](https://railway.com)) | Runs the app on the internet 24/7 | About $5/month (Hobby plan) |
| A **Google** account | To create the "Sign in with Google" setup that lets philos connect calendars | Free |
| **Admin access to your Slack workspace** (or someone who has it) | To install the Slack app | Free |
| A **Gmail account for the society** (e.g. `philo.interviews@gmail.com`) | Sends the digest emails | Free |

Keep a notes file open while you go. You'll collect about **ten values** (keys and IDs) and paste them all into Railway in Step 5. **Treat them like passwords:** don't post them in Slack or commit them to GitHub.

### Step 1: Put the app online (Railway)

You do this first because the other steps need the app's web address.

1. Fork this repository: click **Fork** at the top of this page on GitHub. You now have your own copy.
2. Go to [railway.com](https://railway.com), sign in with GitHub, and click **New Project → Deploy from GitHub repo**. Pick your fork.
3. The first deploy will **crash**. That's expected, because the settings aren't filled in yet.
4. Click the service, open **Settings → Networking**, and click **Generate Domain**. You'll get something like `philo-interviews-production.up.railway.app`.
   📝 Save it as **`BASE_URL`**, with `https://` in front and no slash at the end: `https://philo-interviews-production.up.railway.app`
5. Give the app a permanent disk so bookings survive restarts: right-click the service (or use the **+** button) → **Add Volume**, and set the mount path to **`/data`**.

### Step 2: Google Calendar access

This creates the "Sign in with Google" screen philos see when they connect their calendar.

1. Go to [console.cloud.google.com](https://console.cloud.google.com), and create a new project from the project picker at the top (name it e.g. `Philo Interviews`).
2. Turn on the Calendar API: search for **Google Calendar API** in the top search bar, open it, and click **Enable**.
3. Set up the consent screen (**APIs & Services → OAuth consent screen**, which newer consoles call **Google Auth Platform**):
   - **App name:** `Philo Interviews`. **User support email:** your email.
   - **Audience:** **External**. (Choose **Internal** only if every philo uses the same Google Workspace, e.g. all `@philomathean.org` accounts.)
   - **Data access / Scopes:** add `.../auth/calendar.freebusy` and `.../auth/calendar.events`.
   - **Publishing status:** click **Publish app** so it says **In production**.
     ⚠️ **Don't skip this.** In "Testing" mode, Google disconnects every philo after 7 days. Google won't formally verify an app like this, so philos will see a *"Google hasn't verified this app"* screen when connecting. That's fine: they click **Advanced → Go to Philo Interviews**. It works for up to 100 people.
4. Create the login keys (**APIs & Services → Credentials → Create credentials → OAuth client ID**):
   - **Application type:** **Web application**
   - **Authorized redirect URIs:** add `BASE_URL` followed by `/oauth/google/callback`, e.g. `https://philo-interviews-production.up.railway.app/oauth/google/callback`
   - Click **Create**. 📝 Save the **Client ID** as **`GOOGLE_CLIENT_ID`** and the **Client secret** as **`GOOGLE_CLIENT_SECRET`**.

### Step 3: The Slack app

1. Open [`slack-manifest.yml`](slack-manifest.yml) from your fork and copy all of it. Paste it into a text editor and replace **all three** `https://philo-interviews.example.com` with your `BASE_URL`.
2. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App → From a manifest**. Pick your workspace, choose **YAML**, paste the edited manifest, and click **Next → Create**.
3. On the app's **Basic Information** page, find **App Credentials**. 📝 Save the **Signing Secret** as **`SLACK_SIGNING_SECRET`**.
4. In the left menu, open **Install App** and click **Install to Workspace → Allow**. If you're not a Slack admin, this sends a request to one.
   📝 Save the **Bot User OAuth Token** (starts with `xoxb-`) as **`SLACK_BOT_TOKEN`**.
5. Find the First Censor's Slack ID: in Slack, click their name → **View full profile** → **⋮** (more) → **Copy member ID**.
   📝 Save it as **`FIRST_CENSOR_SLACK_ID`** (looks like `U04ABCDE123`).

> Slack will say the request URL isn't verified yet. That's normal until Step 5 is done; it verifies itself once the app is running.

### Step 4: The email account for digests

The daily digest is sent from a Gmail account using an **app password**, a special password that lets an app send mail as that account.

1. Sign in to the society Gmail account.
2. Turn on **2-Step Verification** at [myaccount.google.com/security](https://myaccount.google.com/security). App passwords require it.
3. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), type the name `Philo Interviews`, and click **Create**. You'll get 16 letters like `abcd efgh ijkl mnop`.
4. Build the `SMTP_URL` using the account's address, but write the `@` in the address as `%40`, and remove the spaces from the password:

   ```
   smtps://philo.interviews%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465
   ```

   📝 Save it as **`SMTP_URL`**. Also save **`EMAIL_FROM`** as `Philo Interviews <philo.interviews@gmail.com>`, using your account's address.

Emails go to `firstcensor@philomathean.org` by default. To send them somewhere else, also save **`DIGEST_TO`**.

### Step 5: Fill in the settings

1. Make one more value, **`SESSION_SECRET`**: a long random password that encrypts everyone's calendar access. Any 64 random letters and numbers will do. On a Mac or Linux terminal you can run `openssl rand -hex 32`. ⚠️ Never change it later, or every philo will have to reconnect.
2. In Railway, click the service, open **Variables → Raw Editor**, and paste this with your values filled in:

   ```
   BASE_URL=https://philo-interviews-production.up.railway.app
   SESSION_SECRET=
   SLACK_BOT_TOKEN=
   SLACK_SIGNING_SECRET=
   FIRST_CENSOR_SLACK_ID=
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   SMTP_URL=
   EMAIL_FROM=
   ```

3. Click **Update Variables**, then **Deploy**. After a minute, open `BASE_URL` followed by `/healthz` in your browser. It should say **ok**.

### Step 6: First run

1. **Check the Slack app.** At [api.slack.com/apps](https://api.slack.com/apps), open **Event Subscriptions** and click **Retry** next to the Request URL until it shows **Verified ✓**.
2. **Set the interview dates (First Censor).** In Slack, type `/philo settings`. Pick the first and last interview days, check the hours and length, check **Open for booking**, and click **Save**.
3. **Connect calendars (every philo).** Each philo types `/philo connect`, clicks **Connect Google Calendar**, and signs in. If they see "Google hasn't verified this app", they click **Advanced → Go to Philo Interviews**.
   You can check who's connected in the app's **Home** tab (click **Philo Interviews** in Slack's sidebar).
4. **Send applicants the link.** Type `/philo link` to get it. It's just your `BASE_URL`.
5. **Test it.** Book a fake interview yourself using your own email, pick a time within the next 24 hours, and check that:
   - the assigned philos got a Slack message and a calendar invite
   - `firstcensor@philomathean.org` got an email starting with `URGENT:`

   Then cancel it from the confirmation page.

🎉 You're done.

---

## Set it up with an AI assistant

If you have an AI assistant that can use a browser and a terminal (like [Claude Code](https://claude.com/claude-code)), paste the prompt below. It will walk you through every step, wait for you whenever you need to sign in or click something, and check each step before moving on. A chat-only assistant like Claude.ai also works; it will just give you instructions instead of doing the clicks.

```text
You are helping me set up "Philo Interviews", an interview scheduler for the Philomathean
Society. The code is at https://github.com/joshuawangia/philo-scheduler. Read its README.md
first. The "Setup guide" section there is the source of truth, so follow it in order
(Steps 1–6).

How to work with me:
- I'm not a programmer. Explain each step in plain language, one step at a time, and wait
  for me to confirm before moving on.
- Whenever I need to sign in, pay, approve something, or copy a secret, stop and tell me
  exactly what to click. Never ask me to paste passwords or keys into this chat unless you
  are directly entering them into Railway for me.
- Keep a running checklist of the values we've collected: BASE_URL, SESSION_SECRET,
  SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, FIRST_CENSOR_SLACK_ID, GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET, SMTP_URL, EMAIL_FROM. Show only which ones are done, not their values.
- Check each step before continuing: e.g. BASE_URL/healthz says "ok", Slack's Request URL
  shows Verified, and a test booking produces the Slack message and the URGENT email.
- Important gotchas: set the Google OAuth app to "In production" (Testing mode disconnects
  people after 7 days); the Google redirect URI must be exactly
  BASE_URL + /oauth/google/callback; replace all three URLs in slack-manifest.yml; the @ in
  the Gmail address inside SMTP_URL must be written %40; never change SESSION_SECRET later.
- If something fails, check the README's Troubleshooting section and the Railway
  deploy logs before guessing.

My details:
- Slack workspace: [e.g. philo.slack.com]
- First Censor's name in Slack: [name]
- Email account that will send the digests: [e.g. philo.interviews@gmail.com]
- Digest recipient (if not firstcensor@philomathean.org): [optional]
- Interview dates: [e.g. Oct 5 – Oct 11]

Start with Step 1.
```

---

## Using it

### Slack commands

| Command | Who | What it does |
|---|---|---|
| `/philo connect` | anyone | Connect your Google Calendar |
| `/philo disconnect` | anyone | Stop being scheduled. Not allowed while you own an upcoming interview's invite; ask the First Censor to reassign it first. |
| `/philo list` | anyone | Your upcoming interviews. The First Censor sees all of them. |
| `/philo link` | anyone | The applicant sign-up link |
| `/philo settings` | First Censor | Dates, hours, length, philos per interview, location, open or closed |
| `/philo open` · `/philo close` | First Censor | Turn applicant sign-ups on or off |
| `/philo censor @someone` | First Censor | Hand the First Censor role to the next person |

### The Home tab

Click **Philo Interviews** in Slack's sidebar and open **Home**. Every philo sees their calendar connection and their upcoming interviews. The First Censor also sees the settings, who's connected, and every interview, each with **Edit** (new time and/or different philos) and **Cancel** buttons. Edits send updated calendar invites to the philos. Tell the applicant yourself, since they aren't on the invite, though their confirmation link always shows the current time.

### The sign-up emails

- **The daily digest** goes out at `DIGEST_HOUR` (default 8am), only if something changed. It lists new sign-ups, changes, and the next 48 hours, with `philo-signups-YYYY-MM-DD.csv` attached. The attachment opens in Excel or Google Sheets.
- **An urgent email** goes out right away when a change touches an interview in the next `URGENT_WINDOW_HOURS` (default 24).
- **Failed sends are retried** every minute. A change is only marked as emailed once the email really goes out.

---

## All settings

Set these in Railway → **Variables** (or in a `.env` file when running on your own computer; see [`.env.example`](.env.example)).

| Variable | Required | Default | What it is |
|---|---|---|---|
| `BASE_URL` | ✅ | | The app's public address, e.g. `https://…up.railway.app` |
| `SESSION_SECRET` | ✅ | | 32+ random characters; never change it |
| `SLACK_BOT_TOKEN` | ✅ | | `xoxb-…` from Slack → Install App |
| `SLACK_SIGNING_SECRET` | ✅ | | Slack → Basic Information |
| `FIRST_CENSOR_SLACK_ID` | ✅ | | Member ID of the first First Censor (only used the first time) |
| `GOOGLE_CLIENT_ID` | ✅ | | Google Cloud → Credentials |
| `GOOGLE_CLIENT_SECRET` | ✅ | | Google Cloud → Credentials |
| `SMTP_URL` | for email | | e.g. `smtps://name%40gmail.com:apppassword@smtp.gmail.com:465`. If blank, emails are only written to the log. |
| `EMAIL_FROM` | | `Philo Interviews <no-reply@philomathean.org>` | Sender shown on the digests. For Gmail, use the Gmail address. |
| `DIGEST_TO` | | `firstcensor@philomathean.org` | Who receives the digests |
| `DIGEST_HOUR` | | `8` | Hour (0–23) the daily digest is sent |
| `URGENT_WINDOW_HOURS` | | `24` | Changes this close to an interview are emailed immediately |
| `TIMEZONE` | | `America/New_York` | |
| `DB_PATH` | | `data/philo.db` (`/data/philo.db` in Docker) | Where bookings are stored |
| `PORT` | | `3000` | Railway sets this automatically |
| `SLACK_APP_TOKEN` | | | Only for local development (Socket Mode) |

Interview dates, hours, length, philos per interview, minimum notice, and location are set **in Slack** with `/philo settings`, not here.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `/healthz` doesn't load, or Railway shows a crash | Open Railway → **Deployments → View logs**. `Missing required env var X` means a variable is empty. `SESSION_SECRET must be at least 32 characters` means it's too short. |
| Slack says "dispatch_failed" or the command does nothing | The URLs in the Slack app don't match `BASE_URL`. Check **Slash Commands**, **Interactivity**, and **Event Subscriptions** at api.slack.com/apps. All three should be `BASE_URL/slack/events`. |
| Google says **redirect_uri_mismatch** | The redirect URI in Google Cloud must be exactly `BASE_URL/oauth/google/callback`: `https`, no trailing slash. |
| Google says "Access blocked" | The OAuth app is in Testing and the person isn't a test user. Publish the app (Step 2.3). |
| Philos get disconnected after a week | The Google OAuth app is still in **Testing**. Publish it, then have philos run `/philo connect` again. |
| The applicant page says "no interview times available" | Check that booking is open, the dates are set (`/philo settings`), and at least as many philos as "philos per interview" have connected. Also check whether everyone is simply busy then. |
| No digest emails | Check the Railway logs for `[digest]` or `[mailer]` lines. For Gmail: 2-Step Verification must be on, the app password must have no spaces, and the `@` in the username must be `%40`. With no `SMTP_URL`, emails are only logged. |
| Bookings disappeared after a redeploy | The volume isn't attached. Add a volume mounted at `/data` (Step 1.5). |

---

## For developers

Requires **Node 22.13+**.

```bash
git clone https://github.com/joshuawangia/philo-scheduler && cd philo-scheduler
cp .env.example .env     # fill it in
npm install
npm test                 # runs the automated tests
npm run dev              # starts the server and restarts it when files change
```

**Local development without a public URL:** in your Slack app, turn on **Socket Mode**, then create an app-level token with the `connections:write` scope and set `SLACK_APP_TOKEN=xapp-…`. Slack then connects to your laptop directly. Set `BASE_URL=http://localhost:3000` and add `http://localhost:3000/oauth/google/callback` as a redirect URI in Google Cloud.

**Other hosts:** any host that runs Docker or Node and has a persistent disk works, e.g. Render, Fly.io, or a small VM. A `Dockerfile` is included. Data is a single SQLite file at `DB_PATH`.

**Code map**

| File | What it does |
|---|---|
| `src/scheduler.js` | Builds time slots, checks calendars, books, cancels, reschedules |
| `src/slack.js` | Slack commands, Home tab, modals, messages to philos |
| `src/web.js`, `src/views.js`, `public/` | Applicant pages and Google sign-in |
| `src/digest.js` | Writes the sign-up email and the CSV |
| `src/digest-runner.js` | Decides when to send (daily and urgent) and retries failures |
| `src/mailer.js` | Sends email over SMTP |
| `src/google.js` | Google Calendar API |
| `src/db.js` | SQLite storage |

---

## Privacy

- Philos grant **free/busy** access only (the app can't see event titles or details), plus permission to create the interview events. Their Google access is encrypted in the database with `SESSION_SECRET`.
- Applicants are never added to the calendar event, and philos' names never appear on applicant pages.
- Applicant names and emails are stored in the database and sent to the First Censor's email. Delete the database file after interview season if you don't need it.

## License

MIT, see [LICENSE](LICENSE).
