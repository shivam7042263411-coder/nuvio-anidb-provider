# Nuvio AniDB Provider

A custom JavaScript streaming provider plugin for the [Nuvio](https://github.com/NuvioMedia/NuvioTV) app that scrapes video sources from [anidb.app](https://anidb.app).

## Features

- Fetches anime streams from anidb.app
- Returns direct HLS (.m3u8) streams
- Zero external dependencies (regex-based, compatible with Hermes/QuickJS)
- Uses TMDB IDs for anime resolution

## Manifest URL

```
https://raw.githubusercontent.com/YOUR_USERNAME/nuvio-anidb-provider/main/manifest.json
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

1. **Search** — Resolves the TMDB ID to an anidb.app anime slug
2. **Episodes** — Scrapes the episode list from the anime page
3. **Sources** — Fetches the embed server for the target episode
4. **Stream** — Extracts the direct `hls.anidb.app/.../master.m3u8` URL

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
- Node.js 18+ for local development only

## Limitations

- Relies on anidb.app's current page structure; may need updates if they change it
- Anime must be indexed on anidb.app
- Some episodes may not resolve if embed structure changes

## Disclaimer

For educational use only. Users are responsible for compliance with applicable laws and the target site's terms of service.

## License

MIT
