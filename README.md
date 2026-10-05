<p align="center"><img src="public/logo.jpg" alt="The Philomathean Society" width="420"></p>

# Philo Interviews

An interview scheduler for the Philomathean Society.

- **Applicants** open a simple web page, see the open interview times, and click one.
- **Philos** connect their Google Calendar once through Slack, so they're only offered for times they're actually free.
- **The First Censor** gets every sign-up by email each morning, and can move or cancel any interview in Slack.

**👉 Setting it up?** Follow the [Setup guide](#setup-guide) below. You don't need any technical experience, a GitHub account, or any code. It takes about an hour, and you can stop and come back at any point.

---

## Contents

- [Setup guide](#setup-guide)
  - [Before you start](#before-you-start)
  - [Step 1: Make your notes page](#step-1-make-your-notes-page)
  - [Step 2: Put the app online](#step-2-put-the-app-online)
  - [Step 3: Let philos connect Google Calendar](#step-3-let-philos-connect-google-calendar)
  - [Step 4: Create the Slack app](#step-4-create-the-slack-app)
  - [Step 5: Set up the email account](#step-5-set-up-the-email-account)
  - [Step 6: Give the app your keys](#step-6-give-the-app-your-keys)
  - [Step 7: Turn it on in Slack](#step-7-turn-it-on-in-slack)
- [Stuck? Get help from an AI assistant](#stuck-get-help-from-an-ai-assistant)
- [Troubleshooting](#troubleshooting)
- [Day-to-day use](#day-to-day-use)
- [Updating the app](#updating-the-app)
- [For developers](#for-developers)
- [Privacy](#privacy)

---

## Setup guide

### Before you start

**You'll need:**

| | What | Cost |
|---|---|---|
| 💳 | A credit or debit card, for the service that runs the app | About **$5 a month** |
| 💬 | To be an **admin of your Slack workspace**, or to know who is (they'll click "Approve" once) | Free |
| 📧 | A **Gmail account for the society** that will send the sign-up emails. Make a new one if you like, e.g. `philo.interviews@gmail.com`. | Free |
| ⏱️ | About **an hour** on a laptop or desktop computer, not a phone | |

**Words you'll see:**

- **Key** (also called a *token*, *secret*, or *ID*): a long jumble of letters, like `xoxb-7731…`. It's a password that lets two services talk to each other. You'll copy a few of them from websites into your notes page. **Treat them like passwords:** don't share them or post them anywhere.
- **Web address**: the link where your app lives, like `https://philo-interviews-production.up.railway.app`.
- **Paste**: <kbd>Ctrl</kbd>+<kbd>V</kbd> on Windows, <kbd>⌘ Cmd</kbd>+<kbd>V</kbd> on a Mac. **Copy**: <kbd>Ctrl</kbd>+<kbd>C</kbd> or <kbd>⌘ Cmd</kbd>+<kbd>C</kbd>.

**How it fits together:** you'll put the app online first, on a service called **Railway**. Then you'll collect keys from **Google**, **Slack**, and **Gmail**, and paste them all into Railway. The app has a **setup page** that shows a ✅ or ❌ next to each key, so you can always see what's left.

> 💡 Websites change their buttons from time to time. If a button in this guide has a slightly different name, look for the closest match. If you get stuck, use the [AI assistant prompt](#stuck-get-help-from-an-ai-assistant).

---

### Step 1: Make your notes page

Open a private note on your computer (Notes, Word, Google Docs, anything) and paste this in. You'll fill in the blanks as you go.

```
BASE_URL=
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GMAIL_ADDRESS=
GMAIL_APP_PASSWORD=
PORT=3000
```

When this guide says **📝 Save as `SOMETHING`**, paste the value right after the `=` on that line, with no spaces, like `SLACK_SIGNING_SECRET=8f2b1c…`.

---

### Step 2: Put the app online

Railway is a service that keeps the app running on the internet all day.

1. Go to **[railway.com](https://railway.com)** and click **Sign up**. Signing up with the society Gmail account is easiest.
2. Choose the **Hobby** plan and add your card when asked.
3. On your Railway dashboard, click **New** (or **+ New Project**), then **Docker Image**. A box appears.
4. Paste this into the box exactly, then press **Enter**:
   ```
   ghcr.io/joshuawangia/philo-scheduler:latest
   ```
   A box called **philo-scheduler** appears on the screen. Railway calls this a *service*.
5. Click the **philo-scheduler** box, open the **Variables** tab, and click **+ New Variable**. Name it `PORT`, set the value to `3000`, and click **Add**.
6. Still in the box, open the **Settings** tab and scroll to **Networking**. Click **Generate Domain**. If it asks which port, type **3000**.
   You'll get a web address like `philo-interviews-production.up.railway.app`.
7. Give the app somewhere permanent to save bookings. **This is important:** without it, all bookings are erased whenever the app restarts.
   - Right-click the **philo-scheduler** box, or press <kbd>Ctrl</kbd>+<kbd>K</kbd> / <kbd>⌘ Cmd</kbd>+<kbd>K</kbd> and type `volume`.
   - Choose **Attach volume** (or **Add Volume**), and set the **mount path** to:
     ```
     /data
     ```
8. Railway asks you to **Deploy** the changes. Click it, and wait about a minute until the box says **Active** or **Online**.
9. Open your web address in a new browser tab, with `https://` in front.

✅ **You should see** the Philomathean logo and a **Setup checklist** with a list of ❌. That's correct: nothing is set up yet. **Keep this tab open.** You'll come back to it after every step.

📝 The checklist shows your exact web address next to `BASE_URL`. **Save as `BASE_URL`**, in the form `https://…railway.app` with no slash at the end.

---

### Step 3: Let philos connect Google Calendar

This creates the "Sign in with Google" screen philos see when they connect their calendar. It's the longest step, so take it slowly.

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)** and sign in with the society Gmail account. If it asks you to agree to terms, agree.
2. **Make a project.** Click the project picker at the top left (it may say *Select a project*), then **New project**. Name it `Philo Interviews` and click **Create**. When it's done, make sure **Philo Interviews** is selected in the picker.
3. **Turn on the Calendar connection.** In the search bar at the top, type `Google Calendar API`, click it in the results, and click **Enable**.
4. **Set up the sign-in screen.** In the search bar, type `Google Auth Platform` (older screens call it *OAuth consent screen*) and open it. Click **Get started**, then:
   - **App name:** `Philo Interviews`. **User support email:** pick your email. Click **Next**.
   - **Audience:** choose **External**. Click **Next**.
   - **Contact information:** your email. Click **Next**.
   - Tick the box to agree, then click **Continue** and **Create**.
5. **Say what the app may access.** In the left menu, click **Data Access**, then **Add or remove scopes**. Scroll to the bottom of the panel, find **Manually add scopes**, and paste these two lines:
   ```
   https://www.googleapis.com/auth/calendar.freebusy
   https://www.googleapis.com/auth/calendar.events
   ```
   Click **Add to table**, then **Update**, then **Save** at the bottom of the page.
6. **Publish it.** In the left menu, click **Audience**. Under **Publishing status**, click **Publish app**, then **Confirm**.
   ⚠️ **Don't skip this.** Otherwise Google disconnects every philo after 7 days.
7. **Make the keys.** In the left menu, click **Clients**, then **+ Create client**:
   - **Application type:** **Web application**. **Name:** `Philo Interviews`.
   - Under **Authorized redirect URIs**, click **+ Add URI**. Go to your app's setup page tab, find **Google → Authorized redirect URI**, click **Copy**, and paste it here. It ends in `/oauth/google/callback`.
   - Click **Create**.
8. A box shows your **Client ID** and **Client secret**. **Copy both now**; the secret may not be shown again. Click **Download JSON** too, as a backup.
   - 📝 **Save as `GOOGLE_CLIENT_ID`**: the long one ending in `.apps.googleusercontent.com`.
   - 📝 **Save as `GOOGLE_CLIENT_SECRET`**: it usually starts with `GOCSPX-`.

---

### Step 4: Create the Slack app

1. Go to **[api.slack.com/apps](https://api.slack.com/apps)** and sign in to your Slack workspace if asked.
2. Click **Create New App**, then **From a manifest**. A *manifest* is a ready-made description of the app, so you don't have to set it up by hand.
3. Pick your workspace and click **Next**.
4. Click the **YAML** tab and delete everything in the box.
5. Go to your app's setup page tab, find **Slack → Create app → From a manifest**, click **Copy**, and paste it into Slack's box. Your web address is already filled in. Click **Next**, then **Create**.
   (If Slack warns that a URL isn't verified yet, that's normal. Ignore it for now.)
6. You're now on the app's **Basic Information** page. Scroll to **App Credentials**, click **Show** next to **Signing Secret**, and copy it.
   📝 **Save as `SLACK_SIGNING_SECRET`.**
7. In the left menu, click **Install App**, then **Install to *your workspace***, then **Allow**.
   - If the button says **Request to Install**, click it. Your Slack admin has to approve the request before you can continue.
8. After installing, you'll see a **Bot User OAuth Token** that starts with `xoxb-`. Click **Copy**.
   📝 **Save as `SLACK_BOT_TOKEN`.**

---

### Step 5: Set up the email account

The app sends the First Censor's sign-up emails from the society Gmail account. Gmail needs a special **app password** for this. It's separate from the normal password, and it only lets the app send mail.

1. Sign in to the society Gmail account and go to **[myaccount.google.com/security](https://myaccount.google.com/security)**.
2. Find **2-Step Verification** and turn it **on**, following Google's steps (it will want a phone number). App passwords don't exist until this is on.
3. Go to **[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)**. Type `Philo Interviews` as the name and click **Create**.
4. Google shows 16 letters in a yellow box, like `abcd efgh ijkl mnop`. Copy them; the spaces don't matter.
   - 📝 **Save as `GMAIL_APP_PASSWORD`.**
   - 📝 **Save as `GMAIL_ADDRESS`**: the Gmail address itself, e.g. `philo.interviews@gmail.com`.

Emails go to **firstcensor@philomathean.org**. To change that, also add a line `DIGEST_TO=someone@example.com` to your notes.

---

### Step 6: Give the app your keys

Your notes page should now have every line filled in.

1. In Railway, click the **philo-scheduler** box, open the **Variables** tab, and click **Raw Editor**.
2. Select everything in the editor, delete it, and paste your whole notes page in.
3. Click **Update Variables**, then **Deploy** when it asks. Wait about a minute until the box says **Active** or **Online**.
4. Go back to the setup page tab and refresh it.

✅ **You should see** a ✅ next to every item. If something has a ❌, the hint next to it tells you what's wrong. Usually a key was copied incompletely or has a space in it. Fix that line in **Raw Editor**, click **Update Variables**, then **Deploy**, and refresh again.

When everything is ✅, your web address shows the applicant page. You can always get back to the checklist by adding `/setup` to the end of your web address.

---

### Step 7: Turn it on in Slack

1. **Let Slack check the connection.** Go back to **[api.slack.com/apps](https://api.slack.com/apps)** → your app → **Event Subscriptions** (in the left menu). Next to **Request URL**, click **Retry** (or **Change** and then **Save**) until it says **Verified ✓**. Click **Save Changes** at the bottom if it appears.
2. **Claim the admin role.** The person who will be First Censor opens Slack, goes to any channel, and types:
   ```
   /philo claim
   ```
   Slack confirms that you're the First Censor. Only the first person to do this gets the role, so do it right away. You can hand it over later with `/philo censor @name`.
3. **Set the interview dates.** Type `/philo settings`. Pick the first and last interview days, tick **Open for booking**, and click **Save**. The other options are fine as they are: 2-hour interviews between 9am and 11pm, with 2 philos per interview.
4. **Ask every philo to connect.** Send them [the message in this section](#message-for-philos). Each philo types `/philo connect` and clicks the button.
5. **Do a test booking.**
   1. Open your web address, book a time within the next day using your own name and email, and click **Reserve**.
   2. Within a minute, the philos picked for it should get a Slack message, and **firstcensor@philomathean.org** should get an email starting with **URGENT:**.
   3. Click **Cancel this interview** on the confirmation page to clean up.
6. **Share the link with applicants.** Type `/philo link` in Slack to get it. It's your web address.

🎉 **You're done!**

#### Message for philos

> Hi! We're scheduling interviews with a Slack app this year. Please take 2 minutes to connect your Google Calendar so you only get booked when you're free:
> 1. In Slack, type `/philo connect` and press Enter.
> 2. Click **Connect Google Calendar** and sign in with the calendar you actually use.
> 3. If Google says *"Google hasn't verified this app"*, click **Advanced**, then **Go to Philo Interviews**. That's expected; it's our own app.
>
> The app can only see when you're busy, never what your events are. You'll get a Slack message and a calendar invite whenever you're assigned an interview.

---

## Stuck? Get help from an AI assistant

Paste the prompt below into an AI assistant like [Claude](https://claude.ai). It walks you through the guide one step at a time and helps you read any error you see. If your assistant can control a browser (for example Claude Code with Claude in Chrome), it can do the clicking for you while you handle sign-ins and payment.

```text
I'm setting up "Philo Interviews", an interview scheduler for the Philomathean Society.
The setup guide is the README at https://github.com/joshuawangia/philo-scheduler.
Please read it and walk me through the "Setup guide" section, Steps 1 to 7, in order.

About me: I have no technical experience. Please:
- Give me one small step at a time, in plain language, and wait for me to say "done" (or
  describe what I see) before giving the next one.
- Tell me exactly what to click and what I should see after each click. If my screen
  looks different from the guide, help me find the matching button.
- Never ask me to paste my keys/passwords into this chat. Just tell me where to put them.
- After each step, have me check the app's setup page (my web address + /setup) and tell
  you which items show ✅ or ❌.
- If something goes wrong, check the guide's "Troubleshooting" section first.

Things that commonly go wrong (please watch for them):
- Railway needs a volume mounted at /data, and PORT=3000.
- In Google, the app must be "Published" (Audience → Publish app), or people get
  disconnected after 7 days.
- The Google redirect URI and the Slack manifest should be copied from my app's
  /setup page, not typed by hand.
- Gmail app passwords only exist after 2-Step Verification is turned on.

My details:
- Slack workspace name: [fill in]
- Society Gmail address that will send emails: [fill in]
- Interview dates: [fill in, e.g. October 5 to October 11]

I'm at Step [1] now.
```

---

## Troubleshooting

| What you see | What to do |
|---|---|
| The web address says **"Application failed to respond"** or won't load | In Railway, check that the **philo-scheduler** box says **Active**. Check that `PORT=3000` is in **Variables**, and that **Settings → Networking** uses port **3000**. Click **Deploy** again. |
| The setup page shows a ❌ | Read the hint next to it. Usually a key was cut off, has a space in it, or was pasted into the wrong line. Fix it in Railway → **Variables → Raw Editor**, click **Update Variables**, then **Deploy**. |
| Bookings or connections disappeared | The volume is missing. Add one with the mount path `/data` ([Step 2.7](#step-2-put-the-app-online)). Philos will need to reconnect once. |
| `/philo` says **"dispatch_failed"** or nothing happens | Do [Step 7.1](#step-7-turn-it-on-in-slack) (Verified ✓). If you made a new Railway web address, recreate the Slack app from the setup page's manifest. |
| Slack says **"/philo is not a valid command"** | The Slack app isn't installed yet, or is waiting for admin approval ([Step 4.7](#step-4-create-the-slack-app)). |
| Google says **"redirect_uri_mismatch"** | The redirect URI in Google doesn't match exactly. Copy it again from the setup page into Google → **Clients** → your client → **Authorized redirect URIs**, then click **Save**. |
| Google says **"Access blocked"**, or philos are disconnected after a week | The Google app isn't published. Do [Step 3.6](#step-3-let-philos-connect-google-calendar), then have philos run `/philo connect` again. |
| Philos see **"Google hasn't verified this app"** | That's expected. Click **Advanced → Go to Philo Interviews**. |
| The applicant page says **"no interview times available"** | Check that booking is open and the dates are set (`/philo settings`), and that at least 2 philos have connected. If the problem persists, everyone may simply be busy then. Check the **Home** tab of the app in Slack to see who's connected. |
| No emails arrive | Check the setup page for the Gmail rows, and look in the spam folder at firstcensor@philomathean.org. The app password must come from the *same* Gmail account as `GMAIL_ADDRESS`. Emails only send when something changed. |
| Anything else | In Railway, click the box → **Deployments** → **View logs**, and paste the last ~30 lines into the [AI assistant](#stuck-get-help-from-an-ai-assistant). Logs don't contain your keys. |

---

## Day-to-day use

### Slack commands

| Command | Who | What it does |
|---|---|---|
| `/philo connect` | anyone | Connect your Google Calendar |
| `/philo disconnect` | anyone | Stop being scheduled. Ask the First Censor to reassign your upcoming interviews first. |
| `/philo list` | anyone | Your upcoming interviews (the First Censor sees all of them) |
| `/philo link` | anyone | The link to send applicants |
| `/philo claim` | First Censor | Take the First Censor role, if nobody has it |
| `/philo settings` | First Censor | Dates, hours, interview length, philos per interview, location, open or closed |
| `/philo open` · `/philo close` | First Censor | Turn applicant sign-ups on or off |
| `/philo censor @name` | First Censor | Hand the First Censor role to the next person |

**The Home tab:** click **Philo Interviews** in Slack's left sidebar and open **Home**. Philos see their calendar status and their interviews. The First Censor also sees every interview, each with **Edit** (change the time or the philos) and **Cancel** buttons. Applicants aren't on the calendar invite, so tell them yourself if you move their interview. Their confirmation link always shows the current time.

### The sign-up emails

- **Every morning at 8am**, if anything changed, the First Censor gets one email. It lists new sign-ups, cancellations and moves, and the next 48 hours, with a spreadsheet of everyone attached.
- **Right away**, with **URGENT:** in the subject, if a change affects an interview in the next 24 hours.

### Changing options

Interview dates, hours, length, philos per interview, and location are all changed in Slack with `/philo settings`. A few more options can be added in Railway → **Variables**:

| Variable | Default | What it does |
|---|---|---|
| `DIGEST_TO` | `firstcensor@philomathean.org` | Who gets the sign-up emails |
| `DIGEST_HOUR` | `8` | Hour of the morning email (0–23) |
| `URGENT_WINDOW_HOURS` | `24` | How close to an interview a change must be to send an urgent email |
| `TIMEZONE` | `America/New_York` | |

---

## Updating the app

When a new version is released, open Railway, click the **philo-scheduler** box, open the **Deployments** tab, and click **Redeploy** on the latest deployment (or the **⋮** menu → **Redeploy**). It fetches the newest version. Bookings and connections are kept on the volume.

---

## For developers

Requires **Node 22.13+**. Every push to `main` runs the tests and publishes `ghcr.io/joshuawangia/philo-scheduler:latest` ([workflow](.github/workflows/docker.yml)).

```bash
git clone https://github.com/joshuawangia/philo-scheduler && cd philo-scheduler
cp .env.example .env     # fill it in
npm install
npm test
npm run dev              # restarts on file changes
```

- **Without a public URL:** turn on **Socket Mode** in the Slack app, create an app-level token with `connections:write`, and set `SLACK_APP_TOKEN=xapp-…`. Then set `BASE_URL=http://localhost:3000` and add `http://localhost:3000/oauth/google/callback` as a Google redirect URI.
- **Other settings** (see [`.env.example`](.env.example)):
  - `SMTP_URL` sends mail through any SMTP server and overrides the Gmail settings.
  - `SESSION_SECRET` is optional. If unset, a secret is generated and stored next to the database.
  - `FIRST_CENSOR_SLACK_ID` is optional. Without it, the First Censor uses `/philo claim`.
  - `DB_PATH` sets where the database is stored.
- **Other hosts:** anything that runs Docker with a persistent disk mounted at `/data` works (Render, Fly.io, a VM).

| File | What it does |
|---|---|
| `src/scheduler.js` | Time slots, calendar checks, booking, cancel, reschedule |
| `src/slack.js` | Slack commands, Home tab, modals, messages to philos |
| `src/web.js`, `src/views.js`, `public/` | Applicant pages, setup page, Google sign-in |
| `src/digest.js`, `src/digest-runner.js`, `src/mailer.js` | The sign-up emails: content, timing, sending |
| `src/google.js` | Google Calendar API |
| `src/config.js`, `src/db.js` | Settings checks and SQLite storage |

---

## Privacy

- Philos give **free/busy** access only (the app can't see event names or details), plus permission to create the interview events. Their Google access is stored encrypted.
- Applicants are never added to the calendar event, and philos' names never appear on applicant pages.
- Applicant names and emails are stored in the app and emailed to the First Censor. To erase everything after interview season, delete the volume in Railway.

## License

MIT, see [LICENSE](LICENSE).
