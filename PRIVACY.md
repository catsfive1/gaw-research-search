# GAW: RE-SEARCH — Privacy Policy

**Last updated: 2026-07-13**

GAW: RE-SEARCH is a search tool. It lets you search the public
greatawakening.win archive (posts and comments) from a browser popup. This
policy describes exactly what the extension does and does not do with data.

## The short version

**No accounts. No login. No tracking. No analytics. No advertising.** The
extension stores your saved searches and recent searches on your own computer
so they're there when you come back. That's it.

## What we collect

**Nothing about you.** We do not collect, and have no way to collect:

- Your name, email, or any identity information
- Your browsing history
- Your IP address (the search proxy does not log it)
- Any analytics, telemetry, or usage statistics
- Cookies or advertising identifiers

## What stays on your computer

These live in Chrome's local extension storage on your machine only. They
never leave your computer and never get sent anywhere except the search
request itself:

- **Your search history** (recent searches — last 30)
- **Your saved searches** (the ones you starred)
- **Your last typed query** (so it's still there if you close and reopen)
- **Your UI preferences** (Advanced Mode on/off, first-run tip dismissed)

You can clear all of this at any time by removing the extension, or by
clearing extension data in Chrome.

## What gets sent over the network

When you run a search or add a post, the extension sends your **search query
and active filters** (keywords, author, date range, score, flair, etc.) to our
search proxy at `gaw-mod-proxy.gaw-mods-a2f2d0e4.workers.dev`. That proxy
forwards the query to the greatawakening.win archive and returns the results.

That is the **only** thing the extension ever sends anywhere. No other data
leaves your computer.

## What the search proxy logs

The search proxy logs **timing and status only** (how long a request took,
whether it succeeded) for abuse-prevention and reliability. It does **not**
log your search queries, your IP address, or any identifying information.

## Third parties

- **greatawakening.win** — the public website being searched. Your search
  query reaches this site's archive via our proxy. The site itself may have
  its own policies.
- **Cloudflare** — hosts our search proxy as a serverless worker. Cloudflare
  may process transit data per [their privacy policy](https://www.cloudflare.com/privacypolicy/).
- **No other third parties.** No analytics, no advertising networks, no data
  brokers, no AI providers.

## Children's privacy

The extension is not directed at children under 13 and we do not knowingly
collect any data from anyone.

## Your choices and rights

- **Delete your data:** remove the extension, or clear extension data in Chrome.
- **Export your data:** your saved searches are visible in the "My Searches"
  panel and can be screenshotted or copied.
- **Use offline:** the extension does nothing when you're not actively searching.

## Changes to this policy

If we change what the extension does with data, we'll update this file and
note the date above. The extension's data flows are also documented in the
code itself (open-source, auditable).

## Contact

Questions about this policy: **catsfive@yahoo.com**

---

*This extension holds no API keys, no AI credentials, and no secrets of any
kind. It is a pure search client. Its entire source code is open for review.*
