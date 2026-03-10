# 💪 Gym Logger — Setup Guide

A mobile-first gym logging app that syncs directly to your Notion Workout Tracker.

---

## What you'll need

- A free **Vercel** account → vercel.com (sign up with Google takes 30 seconds)
- A free **GitHub** account → github.com (same)
- About 10 minutes

---

## Step 1 — Create a Notion Integration

This is a "bot" that lets the app talk to your Notion.

1. Go to **https://www.notion.so/my-integrations**
2. Click **"+ New integration"**
3. Name it **"Gym Logger"**, select your workspace
4. Under **Capabilities**, make sure **Read**, **Update**, and **Insert** are all ticked
5. Click **Save**
6. Copy the **"Internal Integration Token"** (starts with `secret_…`) — you'll need this in Step 4

---

## Step 2 — Share your Notion databases with the integration

You need to do this for each of the 4 databases below.

For each one:
1. Open the database in Notion
2. Click **···** (top right) → **"Add connections"**
3. Search for **"Gym Logger"** and select it

**The 4 databases to connect:**
- **Workouts** (the main workout log)
- **Logbook** (individual sets)
- **Exercises** (exercise library)
- **Muscles Groups** (body parts)

> All four are inside your Workout Tracker page. Open each one as a full page,
> then add the connection.

---

## Step 3 — Push the app to GitHub

1. Go to **github.com** → click **"+"** (top right) → **"New repository"**
2. Name it `gym-logger`, leave it **Public**, click **"Create repository"**
3. On the next screen, click **"uploading an existing file"**
4. Drag the entire `gym-logger` folder contents into the upload area:
   - `index.html`
   - `api/notion.js`
   - `vercel.json`
   - `.env.example`
5. Click **"Commit changes"**

---

## Step 4 — Deploy to Vercel

1. Go to **vercel.com** → sign in → click **"Add New… → Project"**
2. Click **"Import"** next to your `gym-logger` repo
3. Leave all settings as default, click **"Deploy"**
4. Once deployed, go to **Project Settings → Environment Variables**
5. Add:
   - **Name:** `NOTION_TOKEN`
   - **Value:** paste your `secret_…` token from Step 1
6. Click **Save**, then go to **Deployments** → click **"Redeploy"** (top right `···`)

---

## Step 5 — Open on your phone

1. Vercel gives you a URL like `gym-logger-xxxx.vercel.app`
2. Open that URL on your phone in Safari (iPhone) or Chrome (Android)
3. **Save to Home Screen:**
   - iPhone: tap the Share button → "Add to Home Screen"
   - Android: tap the three-dot menu → "Add to Home Screen"

The app will now look and feel like a native app on your phone! 📱

---

## How to use at the gym

1. Tap **Start Workout**
2. Select the **muscle groups** you're training
3. Tap the **exercises** you'll do (tap again to remove)
4. Tap **Start Logging →**
5. Use the **+ / −** buttons to set your weight and reps
6. Tap **LOG SET** after every set — it saves to Notion instantly
7. Tap exercise tabs at the top to switch between exercises
8. Tap **+ Add Exercise** any time to add more
9. Tap **Finish** when done

That's it. Everything is saved to your Notion Workout Tracker automatically.

---

## Troubleshooting

**"Not connected to Notion" banner appears**
- Check your `NOTION_TOKEN` is correct in Vercel environment variables
- Make sure you shared all 4 databases with the integration (Step 2)
- Try redeploying in Vercel after saving the environment variable

**Exercise doesn't appear in the list**
- Make sure the exercise in Notion has a **Muscle Group** relation set
- Open the exercise in Notion → add the muscle group relation

**Set logged but not showing in Notion**
- Check the Logbook database — look for entries with today's date
- If missing, the save may have failed silently — use "Save to Notion" on the finish screen

---

## Future improvements (coming next)

- Show your previous best for each exercise while logging
- Rest timer between sets
- Quick-add exercises directly in the app
