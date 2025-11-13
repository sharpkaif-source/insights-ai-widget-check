# Final Project Prompt — Widget Data Check

Automated Vercel-ready monitor that signs into the Nova demo dashboard, verifies all six **Insights AI** widgets render with live data, and emails an alert if anything is missing or broken.

## How It Works

- `puppeteer-core` + `chrome-aws-lambda` spin up a lightweight headless Chromium instance inside the Vercel function at `/api/check-widgets`.
- The script logs in with `LOGIN_EMAIL` / `LOGIN_PASS`, navigates to `Insights AI`, and waits until each widget card appears.
- Every widget (`Presence AI`, `Competitor AI`, `Reviews AI`, `Pages AI`, `Audience AI`, `Tasks AI`) must contain meaningful content—not blank, zero-only, or error messages.
- If any widget fails validation, `nodemailer` sends an alert email via Gmail.
- Successful runs only log a confirmation message so cron invocations stay silent unless action is needed.

## Project Structure

- `api/check-widgets.js` — Serverless function with Puppeteer logic and email alerting.
- `package.json` — Dependencies and metadata (Node 18+).
- `.env.example` — Required environment variables template.
- `README.md` — You are here.

## Prerequisites

1. **Gmail App Password**
   - Visit [Google Account Security](https://myaccount.google.com/security).
   - Enable **2-Step Verification** if it is not already on.
   - Under **App passwords**, create a new password (choose *Mail* → *Other*).
   - Copy the 16-character password; this becomes `EMAIL_PASS`.

2. **Nova Demo Credentials**
   - Provided login: `mohd.kashif@singleinterface.com`
   - Password: `_G%!ZyM1FR`
   - Store these in `LOGIN_EMAIL` and `LOGIN_PASS`.

## Environment Variables

Create a `.env.local` file for local testing (values mirror `.env.example`):

```
EMAIL_USER=mohd.kashif@singleinterface.com
EMAIL_PASS=your-gmail-app-password
LOGIN_EMAIL=mohd.kashif@singleinterface.com
LOGIN_PASS=_G%!ZyM1FR
TIME_ZONE=Asia/Kolkata
PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe   # optional, for local runs
ALERT_RECIPIENTS=mohd.kashif@singleinterface.com,aijaz@singleinterface.com        # optional list
ALERTS_ENABLED=true                                                               # toggle email alerts
```

> `PUPPETEER_EXECUTABLE_PATH` is optional and only required if you want to execute the check locally with a full Chrome/Chromium installation. Vercel automatically supplies the headless executable via `chrome-aws-lambda`.

### Add Environment Variables in Vercel

1. Deploy or import this project into Vercel.
2. Open **Settings → Environment Variables**.
3. Create the following keys in the **Production** environment:
   - `EMAIL_USER`
   - `EMAIL_PASS`
   - `LOGIN_EMAIL`
   - `LOGIN_PASS`
   - `TIME_ZONE` (optional; defaults to `Asia/Kolkata`)
   - `ALERT_RECIPIENTS` (comma-separated list; defaults to `EMAIL_USER` if omitted)
   - `ALERTS_ENABLED` (`true` to send emails, `false` to mute)
4. Redeploy so the serverless function picks up the secrets.

## Scheduling with cron-job.org

1. Sign in to [cron-job.org](https://cron-job.org/).
2. Add a **New Cronjob** with:
   - **URL**: `https://<your-vercel-project>.vercel.app/api/check-widgets`
   - **Schedule**: Every 30 minutes (`*/30` under minutes).
   - **Monitoring**: Optional, but recommended to get notified if the endpoint stops responding.
3. Cron-job.org will trigger the Vercel endpoint even when your computer is off.

## Local Testing

1. Install dependencies:

```
npm install
```

2. Set the required environment variables (e.g. via PowerShell or `.env.local` with a loader such as `dotenv-cli`).
3. Run the function locally:

```
vercel dev
```

4. Call `http://localhost:3000/api/check-widgets`. Watch the console for the success or failure log.

## Deployment

- Push to a Git repository connected to Vercel.
- Vercel builds the project automatically; no custom build step is needed.
- After deployment, manually hit the public `/api/check-widgets` endpoint once to confirm it passes and logs `[✔] All 6 widgets…`.

## Alerts

- **Success**: Console logs only.
- **Failure**: Gmail sends an email with subject `⚠️ Widget Data Missing on Insights AI Dashboard` listing the widgets that failed and the timestamp.
- Failures also return a JSON payload of the issues so cron-job.org can log the response.

