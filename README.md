# 🫁 Anaesthesia Residency Hub — TOH PGY-1

A standalone, fully functional web app for tracking your residency: EPAs, requirements, cases, references, journal, and daily habits — all synced to Notion.

---

## Setup (10 minutes, one time only)

### 1. Deploy to GitHub Pages

1. Go to [github.com](https://github.com) → **New repository** → name it anything (e.g. `anaes-hub`) → set **Public** → Create
2. On the repo page, click **uploading an existing file**
3. Drag in everything from this folder (`index.html`, the `css` folder, the `js` folder)
4. Click **Commit changes**
5. Go to **Settings → Pages → Source → Deploy from a branch → main → / (root) → Save**
6. Wait ~60 seconds. Your app is live at `https://YOUR_USERNAME.github.io/anaes-hub`

### 2. Create a Notion integration token

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. **New integration** → name it "Anaesthesia Hub" → select your workspace → Submit
3. Copy the **Internal Integration Secret** (starts with `secret_`)

### 3. Share your three Notion databases with the integration

For each of these, open it in Notion → click **••• (top right)** → **Connections** → **Connect to** → select your integration:

- Requirements & Milestones
- Case Log
- Resource Library

(If you don't have these yet, ask Claude to create them — they were set up earlier in this project with specific schemas the app expects.)

### 4. Open your app and connect

Visit your GitHub Pages URL → paste your token → you're in.

---

## How it works

**Dashboard** — EPA progress ring, study streak, 3 daily wins, habit check-in, upcoming deadlines, mini calendar.

**Calendar** — full month view with a color-coded activity legend (journal/case/habit), click any day to see what happened.

**References** — Quick Reference (drug references + mnemonics) at the top, full resource library below with topic filters.

**Requirements & goals** — EPAs with running counters toward a target (e.g. 14/20 epidurals — tap "Log one" each time), block-mandated goals (amber), personal learning goals (teal).

**Case log** — list view, filterable by rotation and tag, click to expand. "Add case" opens a full-screen single-page form.

**Journal** — free daily writing space with its own streak tracker and a scrollable history of past entries.

**Settings** — rotation, start date, Notion connection, sync.

All data writes to and reads from your Notion databases. A local cache means the app loads instantly even on slow connections, and still works (read-only feel) if Notion is briefly unreachable.

## Notes on data model

- **EPAs** are stored as Requirements-database pages with Category = "EPA"; their target/count live as JSON in the Notes field, since Notion's schema doesn't have native counter fields.
- **Journal entries** are stored as Resource-database pages with Type = "Journal" and the date in the Topic field.
- This keeps everything in the three databases you already have, with no new Notion setup required beyond the original schema.

## Security

Your Notion token lives only in your browser's localStorage. It is sent directly to Notion's API (via a CORS proxy that does not log or store requests) and nowhere else.
