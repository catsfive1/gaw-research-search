# GAW: RE-SEARCH

A Chrome extension for searching the entire greatawakening.win archive —
130,000+ posts and comments — right from your browser toolbar. No login. No
tracking. Free.

**Current version: 2.5.1** · **Status: active**

---

## What it does

- Keyword-search every post and comment on greatawakening.win
- Advanced filters: date range, author, score, flair, comment count, scope, sort
- Advanced Mode: exact-phrase, any-of (OR), and exclude (NOT) operators with a
  live compiled-query preview
- Save searches (★), recent-search chips, copy-results-to-clipboard
- "Add a Post" — paste a GAW link to index it on the spot
- Removed/deleted posts are indexed and flagged with a REMOVED badge

---

## 📥 How to install (first time)

You only do these steps once. Takes about 2 minutes.

### Step 1 — Download

1. Go to the [Releases page](https://github.com/catsfive1/gaw-research-search/releases).
2. Find the newest release at the top.
3. Under **Assets**, click `gaw-research-search-vX.X.X.zip` to download it.

### Step 2 — Unzip

1. Find the ZIP in your Downloads folder.
2. **Right-click → Extract All** (Windows) or **double-click** (Mac).
3. You'll get a folder named `gaw-research-search-vX.X.X` (or similar).
   Remember where it is — Desktop or Documents works fine.

### Step 3 — Load it into Chrome

1. Open Chrome (or Brave, Edge, Opera — any Chromium browser).
2. Type this into the address bar and press Enter:
   ```
   chrome://extensions
   ```
3. Turn on **Developer mode** — the toggle in the **top-right corner**.
4. Click **Load unpacked** — the button in the **top-left corner**.
5. A folder picker opens. Select the folder you unzipped in Step 2
   (the one containing `manifest.json`) and click **Select Folder**.
6. Done. The ⚖ GAW: RE-SEARCH icon appears in your toolbar.

> **Can't see the icon?** Click the puzzle-piece 🧩 icon in your toolbar and
> pin GAW: RE-SEARCH so it stays visible.

---

## 🔄 How to update (when a new version comes out)

There are **two ways**. The Quick Reload works when you've already got the new
files; the Re-download is when there's a brand-new release.

### Quick Reload (you already updated the folder)

If you replaced the files in your unpacked folder with a newer version:

1. Go to `chrome://extensions`
2. Find **GAW: RE-SEARCH** in the list.
3. Click the **circular-arrow ↻ Reload** button on its card.
4. The new version loads. Check the version number in the extension popup
   footer (bottom of the popup window) to confirm.

### Re-download (a new release was published)

1. Go to the [Releases page](https://github.com/catsfive1/gaw-research-search/releases).
2. Download the newest `gaw-research-search-vX.X.X.zip`.
3. Unzip it (you can put it in the same place as before, or a new folder).
4. Go to `chrome://extensions`.
5. Click **Remove** on the old GAW: RE-SEARCH card.
6. Click **Load unpacked** and select the new folder.
7. Your saved searches carry over (they're stored in Chrome, not the folder).

### Check for Updates button

The extension popup has a **"Check for Updates"** button at the bottom. Click
it anytime — it opens the GitHub Releases page in a new tab so you can see if
a newer version exists. There's no auto-update for "Load unpacked"
extensions (that's a Chrome limitation, not a choice), so this button is how
you stay current.

---

## 🧰 Tips on using it

- **Just type and hit Enter.** That's the whole learning curve.
- **Filters card** (collapsed by default) — date presets (24h / 7 days / 30 days
  / custom), author, score, flair, comment count, scope, sort.
- **Advanced Mode** (flip the switch up top) — exact phrase, any-of (OR),
  exclude (NOT). A live preview shows the actual query as you type.
- **★ Star** a search to save it. Recent searches appear as one-tap chips.
- **Copy results** — grabs your on-screen results as a markdown list.
- **⊕ Add a Post** — got a post the search missed, or a bookmark worth
  preserving? Paste a GAW post link to index it immediately.
- **Copy debug info** — if something's broken, click this before reporting and
  paste the result. It's timings and status codes only — no personal data.

---

## 🔧 For power users

### Keyboard shortcut to open the popup

You can assign a keyboard shortcut so the search opens instantly — no clicking
the toolbar icon required.

1. Go to `chrome://extensions/shortcuts` (or click the hamburger menu in
   `chrome://extensions` → **Keyboard shortcuts**).
2. Find **GAW: RE-SEARCH**.
3. Click the box next to "Activate the extension" and press your combo
   (e.g. `Ctrl+Shift+S` or `Cmd+Shift+S` on Mac).
4. Now that combo opens the search popup anywhere in the browser.

### Install via `git clone` (instead of the ZIP)

If you have `git` installed, you can skip the ZIP download entirely — and
updating becomes a single command instead of a re-download.

**Install (one time):**

```bash
git clone https://github.com/catsfive1/gaw-research-search.git
```

Then in `chrome://extensions`, click **Load unpacked** and select the
`gaw-research-search` folder that `git clone` created.

**Update later (any time):**

```bash
cd gaw-research-search
git pull
```

Then hit **↻ Reload** on the GAW: RE-SEARCH card in `chrome://extensions`.
That's it — no ZIP, no folder-swapping, no re-download.

*(Credit: u/Podger on greatawakening.win for both tips.)*

---

## 🔧 Troubleshooting

**The extension won't load / I get an error.**
Make sure you selected the folder that *contains* `manifest.json` — not a
parent folder, and not a file inside it. If Chrome says "manifest not found,"
you picked the wrong folder.

**I updated but still see the old version.**
Go to `chrome://extensions` and click the ↻ **Reload** button on the GAW:
RE-SEARCH card. The version number at the bottom of the popup confirms what
you're running.

**My saved searches disappeared.**
They're tied to the extension's folder location in Chrome. If you removed the
old extension and loaded a new folder, saved searches reset. This is normal —
re-save them. Going forward, a simple **Reload** (not Remove + Reload) keeps
them intact.

**The search says "rate limited" / "catching its breath."**
This is the anti-abuse guard doing its job. Wait for the countdown to finish
(it's a few seconds), then try again. Normal searching never trips it.

**It worked before but now does nothing.**
The service worker may have gone idle. Close the popup and reopen it, or click
↻ Reload on the extensions page. That wakes it back up.

**I'm on Firefox.**
Sorry — this is a Chromium extension. It works in Chrome, Brave, Edge, Opera,
and Vivaldi. Firefox uses a different system and isn't supported.

---

## 🔒 Privacy

No accounts. No login. No tracking. No analytics. No advertising. The only
thing that ever leaves your machine is your search query, sent to our search
proxy so the archive can return results. Your saved and recent searches live
on your own computer only.

The extension asks for exactly one permission: `storage` (so it remembers your
saved searches). It has zero content scripts — it cannot read any webpage you
visit. The full source ships as plain, readable JavaScript; you can open every
file and audit it.

See [`PRIVACY.md`](PRIVACY.md) for the complete policy.

---

## 🐞 Bugs, feedback, questions

Drop a comment in the announcement thread, or email **catsfive@yahoo.com**.
If something's broken, click **"Copy debug info"** in the popup footer first
and paste it with your report — it makes fixes 10× faster.

---

## 👤 Maintainer

**Commander Cats** — [catsfive@yahoo.com](mailto:catsfive@yahoo.com)

This is an unofficial community tool, not affiliated with greatawakening.win
or Scored.co.
