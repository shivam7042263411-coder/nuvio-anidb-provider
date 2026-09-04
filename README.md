# Nuvio AniDB Provider

A custom JavaScript streaming provider plugin for the [Nuvio](https://github.com/NuvioMedia/NuvioTV) app that scrapes video sources from [anidb.app](https://anidb.app).

## Features

- Fetches anime streams from anidb.app
- Returns direct HLS (.m3u8) streams
- Zero external dependencies (regex-based, compatible with Hermes/QuickJS)
- Uses TMDB IDs for anime resolution

## Manifest URL

```
https://raw.githubusercontent.com/shivam7042263411-coder/nuvio-anidb-provider/main/manifest.json
```

Provider file (referenced by the manifest):
```
https://raw.githubusercontent.com/shivam7042263411-coder/nuvio-anidb-provider/main/providers/anidb.js
```

## Installation

### Using in Nuvio App

1. Open **Nuvio** > **Settings** > **Plugins**
2. Add the repository URL above
3. Refresh and enable the **AniDB** provider

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

### AniDB (anidb.app)

1. **mapping** — `TMDB ID` → `https://api.ani.zip/mappings?themoviedb_id={id}` → AniList ID (no API key)
2. **title** — AniList `graphql.anilist.co` (no API key) → the anime's English/Romaji title
3. **search** — `https://anidb.app/browse?q={title}` → anime slug (e.g. `demon-slayer-kimetsu-no-yaiba-1217`)
4. **episodes** — `https://anidb.app/api/frontend/anime/{numId}/episodes` → find episode by number → episode id
5. **languages/embeds** — `https://anidb.app/api/frontend/episode/{epId}/languages` → first `embed_url`
6. **stream** — `GET embed_url` → regex `sources:[{file:'...'}]` → direct `hls.anidb.app/.../master.m3u8`

### Miruro (miruro.tv)

1. **mapping** — `TMDB ID` → `api.ani.zip` → AniList ID (same as above)
2. **episodes** — call miruro's `secure/pipe` API (`path: episodes`, `anilistId`) → provider/category episode list
3. **sources** — call `secure/pipe` (`path: sources`, base64url episode id) → `streams[].url` (direct m3u8)
4. **decoding** — the pipe response is base64 + gzip; a bundled pure-JS DEFLATE inflater decodes it (Nuvio strips `Accept-Encoding`, so it may also arrive uncompressed)

## Stream Object

```javascript
{
  name: "AniDB",
  title: "Episode 1",
  url: "https://hls.anidb.app/stream/.../master.m3u8",
  quality: "1080p",
  headers: { "Referer": "https://anidb.app/", "User-Agent": "..." }
}
```

## Requirements

- Nuvio app (sideloaded version — store versions don't support plugins)
- Network access to anidb.app, api.ani.zip, and graphql.anilist.co
- Node.js 18+ for local development only

## Limitations

- Relies on the source sites' current page/API structure; may need updates if they change it
- Anime must be indexed on the source and resolvable via the TMDB/AniList mapping
- anidb.app is behind Cloudflare; on-device requests use Nuvio's native HTTP stack (real TLS) and usually succeed, but strict bot protection may occasionally return a 503
- miruro.tv's `secure/pipe` endpoint is also Cloudflare-protected and may 403 from some networks; it can only be verified on-device
- Multi-season series are matched best-effort by appending "Season N" to the search
- The gzip/DEFLATE inflater is a compact pure-JS implementation; it has been unit-tested against reference data but only the full on-device path can confirm end-to-end

## Source Status

- **anidb.app** had a genuine maintenance outage (503 "Under Maintenance") starting ~Sep 3, 2026; it should recover on its own.
- **miruro.tv** could not be reached from development environments (Cloudflare datacenter blocks) — it must be tested from the device.

## Disclaimer

For educational use only. Users are responsible for compliance with applicable laws and the target site's terms of service.

## License

MIT
