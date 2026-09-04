// Aniwave (aniwaves.ru) Provider for Nuvio
// QuickJS compatible - no external deps, regex based.
//
// aniwaves.ru is a Zoro/HiAnime-style clone. Its classic backend is reachable
// and returns the full chain down to the per-server embed URL. The final
// players (echo/playmogo/gn1r5n - all VidPlay-family) are obfuscated / 403 to
// scripted clients and can't be reduced to a plain m3u8 from this runtime, so
// the provider returns the resolved embed URL as an iframe-style stream.
//
// Flow (verified live):
//   tmdbId -> ani.zip mapping -> anilist_id
//          -> AniList GraphQL -> anime title
//          -> /filter?keyword={title} -> /watch/{slug}-{watchId}
//          -> /ajax/episode/list/{watchId}        -> data-ids of requested ep
//          -> /ajax/server/list?servers={id}&eps={n} (TWO query params!)
//          -> /ajax/sources?id={linkId}&asi=0&autoPlay=0 -> result.url (embed)

var BASE = "https://aniwaves.ru";
var ANIZIP = "https://api.ani.zip/mappings";
var ANILIST = "https://graphql.anilist.co";
var AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fetchText(url, headers, method, body) {
    var opts = { headers: headers || { "User-Agent": AGENT, "Referer": BASE + "/" } };
    if (method) opts.method = method;
    if (body) opts.body = body;
    return fetch(url, opts).then(function(res) {
        if (!res.ok) return "";
        return res.text();
    }).catch(function() {
        return "";
    });
}

function safeJson(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

// ---------- TMDB -> AniList -> title ----------
function mapAnilistFromTmdb(tmdbId) {
    return fetchText(ANIZIP + "?themoviedb_id=" + encodeURIComponent(tmdbId), {
        "Accept": "application/json",
        "User-Agent": AGENT
    }).then(function(text) {
        var parsed = safeJson(text);
        if (!parsed || parsed === "Not Found" || !parsed.mappings) return "";
        var id = parsed.mappings.anilist_id;
        return id === undefined || id === null ? "" : String(id);
    });
}

function titleFromAnilist(anilistId) {
    if (!anilistId) return Promise.resolve("");
    var query = "{ Media(id: " + anilistId + ") { title { romaji english } } }";
    return fetchText(ANILIST, {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": AGENT
    }, "POST", JSON.stringify({ query: query })).then(function(text) {
        var parsed = safeJson(text);
        if (!parsed || !parsed.data || !parsed.data.Media || !parsed.data.Media.title) return "";
        var t = parsed.data.Media.title;
        return t.english || t.romaji || "";
    });
}

// ---------- aniwaves search -> watch id + slug ----------
function searchWatchId(title) {
    if (!title) return Promise.resolve(null);
    var url = BASE + "/filter?keyword=" + encodeURIComponent(title);
    return fetchText(url, { "User-Agent": AGENT, "Referer": BASE + "/" }).then(function(html) {
        // collect /watch/{slug}-{id} links
        var re = /href="\/watch\/([a-z0-9-]+)-([0-9]+)"/g;
        var best = null;
        var wanted = title.toLowerCase().replace(/[^a-z0-9]+/g, " ");
        var m;
        while ((m = re.exec(html)) !== null) {
            var slug = m[1];
            var id = m[2];
            var entry = { id: id, slug: slug };
            if (!best) best = entry;
            // score: exact title match preferred
            var slugSpace = slug.replace(/[^a-z0-9]+/g, " ").toLowerCase();
            if (slugSpace === wanted) return entry;
            if (slugSpace.indexOf(wanted) !== -1 && (!best || !best._scored || best._score < 2)) {
                entry._scored = true;
                best._scored = true;
                best._score = 2;
                best = entry;
            }
        }
        return best ? { id: best.id, slug: best.slug } : null;
    });
}

// ---------- episodes ----------
function findEpisodeDataIds(watchId, slug, episodeNum) {
    var url = BASE + "/ajax/episode/list/" + watchId;
    return fetchText(url, {
        "User-Agent": AGENT,
        "Referer": BASE + "/watch/" + slug,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "*/*"
    }).then(function(text) {
        var parsed = safeJson(text);
        var html = parsed ? (parsed.result !== undefined ? String(parsed.result) : "") : "";
        if (!html) html = typeof text === "string" && text.indexOf("data-ids") !== -1 ? text : "";
        // <a ... data-ids="{id}&amp;eps={n}" data-num="{n}" ...>
        var re = new RegExp('data-ids="([^"]*)"[^>]*data-num="' + episodeNum + '"');
        var re2 = new RegExp('data-num="' + episodeNum + '"[^>]*data-ids="([^"]*)"');
        var m = html.match(re) || html.match(re2);
        if (!m) return null;
        var raw = m[1].replace(/&amp;/g, "&");
        // raw is e.g. "78052&eps=1" -> { id, ep }
        var mm = raw.match(/^(.+?)&eps=(\d+)$/);
        if (!mm) return null;
        return { id: mm[1], ep: mm[2] };
    });
}

// ---------- servers ----------
function pickServerLinkId(serverInfo, episodeNum, wantDub) {
    // serverInfo = { id, ep } from findEpisodeDataIds
    var url = BASE + "/ajax/server/list?servers=" + encodeURIComponent(serverInfo.id) +
              "&eps=" + encodeURIComponent(serverInfo.ep);
    return fetchText(url, {
        "User-Agent": AGENT,
        "Referer": BASE + "/watch/" + serverInfo.slug + "?ep=" + episodeNum,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "*/*"
    }).then(function(text) {
        var parsed = safeJson(text);
        var html = parsed ? (parsed.result !== undefined ? String(parsed.result) : "") : "";
        if (!html) html = typeof text === "string" && text.indexOf("data-link-id") !== -1 ? text : "";
        if (!html) return "";
        // choose the sub (or dub) group first: <div class="type" data-type="sub"> ... </div>
        var type = wantDub ? "dub" : "sub";
        var tm = html.match(new RegExp('data-type="' + type + '"(.*?)</div>', ""));
        var seg = tm ? tm[1] : html;
        var m = seg.match(/data-link-id="([^"]+)"/);
        return m ? m[1] : "";
    });
}

function resolveEmbedUrl(linkId, slug, episodeNum) {
    var url = BASE + "/ajax/sources?id=" + encodeURIComponent(linkId) + "&asi=0&autoPlay=0";
    return fetchText(url, {
        "User-Agent": AGENT,
        "Referer": BASE + "/watch/" + slug + "?ep=" + episodeNum,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json"
    }).then(function(text) {
        var parsed = safeJson(text);
        var r = parsed && parsed.result ? parsed.result : null;
        if (r && r.url) {
            return r.url; // embed URL (e.g. https://play.echovideo.ru/embed-1/...)
        }
        return "";
    });
}

function buildResult(embedUrl, mediaType, season, episode, serverName, slug) {
    var title = mediaType === "movie"
        ? "Movie " + (season || 1)
        : "S" + String(season || 1).padStart(2, "0") + "E" + String(episode || 1).padStart(2, "0");
    if (!embedUrl) return [];
    return [{
        name: "Aniwave " + (serverName || ""),
        title: title,
        url: embedUrl,
        quality: 1080,
        headers: {
            "Referer": BASE + "/watch/" + slug + "?ep=" + (episode || 1),
            "User-Agent": AGENT
        }
    }];
}

function getStreams(tmdbId, mediaType, season, episode) {
    season = Number(season) || 1;
    episode = Number(episode) || 1;
    if (mediaType === "movie") episode = 1;

    return mapAnilistFromTmdb(tmdbId)
        .then(function(anilistId) {
            if (!anilistId) return "";
            return titleFromAnilist(anilistId);
        })
        .then(function(title) {
            if (!title) return [];
            return searchWatchId(title).then(function(w) {
                if (!w) return [];
                return findEpisodeDataIds(w.id, w.slug, episode).then(function(serverInfo) {
                    if (!serverInfo) return [];
                    serverInfo.slug = w.slug;
                    return pickServerLinkId(serverInfo, episode, false).then(function(linkId) {
                        if (!linkId) return [];
                        return resolveEmbedUrl(linkId, w.slug, episode).then(function(embedUrl) {
                            return buildResult(embedUrl, mediaType, season, episode, "Embed", w.slug);
                        });
                    });
                });
            });
        });
}

module.exports = { getStreams: getStreams };
