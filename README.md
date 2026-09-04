# Nuvio AniDB + Aniwaves Provider

A custom JavaScript streaming provider plugin for the [Nuvio](https://github.com/NuvioMedia/NuvioTV) app that scrapes anime video sources from [anidb.app](https://anidb.app) and [aniwaves.ru](https://aniwaves.ru).

## Features

- Fetches anime streams from anidb.app and aniwaves.ru
- Returns direct HLS (.m3u8) streams (anidb) and resolved embed URLs (aniwaves)
- Zero external dependencies (regex-based, compatible with Hermes/QuickJS)
- Uses TMDB IDs for anime resolution

## Manifest URL

```
https://raw.githubusercontent.com/shivam7042263411-coder/nuvio-anidb-provider/main/manifest.json
```

Provider files (referenced by the manifest):
```
https://raw.githubusercontent.com/shivam7042263411-coder/nuvio-anidb-provider/main/providers/anidb.js
https://raw.githubusercontent.com/shivam7042263411-coder/nuvio-anidb-provider/main/providers/aniwaves.js
```

## Installation

### Using in Nuvio App

1. Open **Nuvio** > **Settings** > **Plugins**
2. Add the repository URL above
3. Refresh and enable the **AniDB** / **Aniwaves** provider

### Local Development

1. Clone the repo and start a static server for the `providers/` and `manifest.json` files:
   ```bash
   npm install
   npm start
   ```
2. In the Nuvio app, go to **Settings** > **Developer** > **Plugin Tester**
3. Enter `http://YOUR_IP_ADDRESS:3000/manifest.json`

## How It Works

The providers are given only a TMDB ID by Nuvio, so they first resolve the title/AniList ID before searching the source sites (which require a title, not a TMDB ID).

### Mapping (shared by both providers)

1. **mapping** — `TMDB ID` → `https://api.ani.zip/mappings?themoviedb_id={id}` → AniList ID (no API key; NOTE: coverage is incomplete — some TMDB IDs are not in the mapping and resolve to nothing)
2. **title** — AniList `graphql.anilist.co` (no API key) → the anime's English/Romaji title

### AniDB (anidb.app)

3. **search** — `https://anidb.app/browse?q={title}` → anime slug (e.g. `demon-slayer-kimetsu-no-yaiba-1217`)
4. **episodes** — `https://anidb.app/api/frontend/anime/{numId}/episodes` → find episode by number → episode id
5. **languages/embeds** — `https://anidb.app/api/frontend/episode/{epId}/languages` → first `embed_url`
6. **stream** — `GET embed_url` → regex `sources:[{file:'...'}]` → direct `hls.anidb.app/.../master.m3u8`

### Aniwaves (aniwaves.ru)

3. **search** — `https://aniwaves.ru/filter?keyword={title}` → `/watch/{slug}-{watchId}` (best title match)
4. **episodes** — `https://aniwaves.ru/ajax/episode/list/{watchId}` → `<a data-ids="{id}&eps={n}" data-num="{n}">` for the requested episode
5. **servers** — `https://aniwaves.ru/ajax/server/list?servers={id}&eps={n}` (**two separate query params** — the single-param form returns empty) → first `sub` server's link id
6. **sources** — `https://aniwaves.ru/ajax/sources?id={linkId}&asi=0&autoPlay=0` → `result.url` (the VidPlay-family embed URL)
7. **embed** — the resolved embed URL is returned as an iframe-style stream entry (see Limitations)

## Stream Object

```javascript
{
  name: "Aniwave Embed",
  title: "S01E01",
  url: "https://play.echovideo.ru/embed-1/...",
  quality: 1080,
  headers: { "Referer": "https://aniwaves.ru/watch/shingeki-no-kyojin?ep=1", "User-Agent": "..." }
}
```

## Requirements

- Nuvio app (sideloaded version — store versions don't support plugins)
- Network access to anidb.app, aniwaves.ru, api.ani.zip, and graphql.anilist.co
- Node.js 18+ for local development only

## Limitations

- **TMDB→AniList mapping is incomplete.** `api.ani.zip` only maps a subset of anime TMDB IDs. If a title can't be resolved, the provider returns no streams. This is the most common cause of "no stream found".
- aniwaves.ru's final players (echo/playmogo/gn1r5n — all VidPlay-family) are heavily obfuscated and 403 to scripted clients, so the provider returns the resolved **embed URL** rather than a direct m3u8. The embed must be rendered in a player/iframe (Nuvio's "embed" stream support). It works best in an external player that can execute the embed page.
- anidb.app is behind Cloudflare; on-device requests use Nuvio's native HTTP stack (real TLS) and usually succeed, but strict bot protection may occasionally return a 503.
- Multi-season series are matched best-effort by the title slug match; specific season/entry selection may be ambiguous when the site uses per-season slugs.
- Relies on the source sites' current page/API structure; may need updates if they change it.

## Source Status

- **anidb.app** had a genuine maintenance outage (503 "Under Maintenance") starting ~Sep 3, 2026; it should recover on its own. It is a historical/legacy source.
- **aniwaves.ru** (Zoro/HiAnime clone) is the primary verified source: the full search→episode→server→source chain was validated live from development, returning real embed URLs.
- **miruro.tv** was removed — its `secure/pipe` endpoint 403'd from datacenter IPs and could not be reliably scraped.

## Disclaimer

For educational use only. Users are responsible for compliance with applicable laws and the target site's terms of service.

## License

MIT
