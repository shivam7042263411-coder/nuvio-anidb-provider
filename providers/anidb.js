// AniDB (anidb.app) Provider for Nuvio
// QuickJS compatible - no external deps, regex based.
//
// Flow (matches anidb.app frontend runtime):
//   tmdbId -> ani.zip mapping -> anilist_id
//          -> AniList GraphQL -> anime title
//          -> anidb /browse?q={title} -> anime slug -> numerical id
//          -> /api/frontend/anime/{id}/episodes -> episode id
//          -> /api/frontend/episode/{epId}/languages -> embed_url
//          -> GET embed -> sources:[{file:'...m3u8'}] -> stream url

var BASE = "https://anidb.app";
var ANIZIP = "https://api.ani.zip/mappings";
var ANILIST = "https://graphql.anilist.co";
var AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fetchText(url, headers, method, body) {
    var opts = {
        headers: headers || {
            "User-Agent": AGENT,
            "Referer": BASE + "/"
        }
    };
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

function mapAnilistFromTmdb(tmdbId) {
    return fetchText(ANIZIP + "?themoviedb_id=" + encodeURIComponent(tmdbId), {
        "Accept": "application/json",
        "User-Agent": AGENT
    }).then(function(text) {
        var parsed = safeJson(text);
        if (!parsed || !parsed.mappings) return "";
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

function searchAnime(title) {
    if (!title) return Promise.resolve("");
    var url = BASE + "/browse?q=" + encodeURIComponent(title);
    return fetchText(url).then(function(html) {
        var re = /\/anime\/([a-z0-9-]+-[0-9]+)/g;
        var m = re.exec(html);
        return m ? m[1] : "";
    });
}

function numericalIdFromSlug(slug) {
    if (!slug) return "";
    var m = slug.match(/-([0-9]+)$/);
    return m ? m[1] : "";
}

function findEpisode(animeId, episodeNum) {
    var url = BASE + "/api/frontend/anime/" + animeId + "/episodes";
    return fetchText(url, { "Accept": "application/json", "User-Agent": AGENT })
        .then(function(text) {
            var parsed = safeJson(text);
            if (!parsed || !parsed.episodes) return null;
            for (var i = 0; i < parsed.episodes.length; i++) {
                var ep = parsed.episodes[i];
                if (String(ep.number) === String(episodeNum)) {
                    return String(ep.id);
                }
            }
            return null;
        });
}

function getEmbedUrl(episodeId) {
    var url = BASE + "/api/frontend/episode/" + episodeId + "/languages";
    return fetchText(url, { "Accept": "application/json", "User-Agent": AGENT })
        .then(function(text) {
            var parsed = safeJson(text);
            if (!parsed || !parsed.languages || parsed.languages.length === 0) return "";
            var embed = parsed.languages[0].embed_url;
            return embed || "";
        });
}

function extractM3u8(embedUrl) {
    if (!embedUrl) return Promise.resolve([]);
    return fetchText(embedUrl).then(function(html) {
        var re = /sources:\s*\[{\s*file:\s*['"]([^'"]+)['"]/;
        var m = html.match(re);
        if (m && m[1]) {
            return [{ url: m[1], label: "Master HLS" }];
        }
        var re2 = /https:\/\/hls\.anidb\.app\/stream\/[^"'\s,)]+master\.m3u8/g;
        var streams = [];
        var mm;
        while ((mm = re2.exec(html)) !== null) {
            streams.push({ url: mm[0], label: "Master HLS" });
        }
        return streams;
    });
}

function buildResult(streams, mediaType, season, episode) {
    var title = mediaType === "movie"
        ? "Movie " + (season || 1)
        : "S" + String(season || 1).padStart(2, "0") + "E" + String(episode || 1).padStart(2, "0");
    var out = [];
    var seen = {};
    for (var i = 0; i < streams.length; i++) {
        var s = streams[i];
        if (!s.url || seen[s.url]) continue;
        seen[s.url] = true;
        out.push({
            name: "AniDB HLS",
            title: title,
            url: s.url,
            quality: 1080,
            headers: {
                "Referer": BASE + "/",
                "User-Agent": AGENT
            }
        });
    }
    return out;
}

function getStreams(tmdbId, mediaType, season, episode) {
    season = Number(season) || 1;
    episode = Number(episode) || 1;
    var isMovie = mediaType === "movie";
    if (isMovie) episode = 1;

    return mapAnilistFromTmdb(tmdbId)
        .then(function(anilistId) {
            return titleFromAnilist(anilistId);
        })
        .then(function(title) {
            if (!title) return "";
            if (!isMovie && season > 1) {
                // Prefer the specific season entry for multi-season shows
                var seasonTerm = title.match(/ season \d+$/i) ? title : title + " Season " + season;
                return searchAnime(seasonTerm).then(function(slug) {
                    return slug || searchAnime(title);
                });
            }
            return searchAnime(title);
        })
        .then(function(slug) {
            if (!slug) return [];
            return findEpisode(numericalIdFromSlug(slug), episode || 1);
        })
        .then(function(episodeId) {
            if (!episodeId) return [];
            return getEmbedUrl(episodeId);
        })
        .then(function(embedUrl) {
            if (!embedUrl) return [];
            return extractM3u8(embedUrl);
        })
        .then(function(streams) {
            return buildResult(streams, mediaType, season, episode);
        })
        .catch(function() {
            return [];
        });
}

module.exports = { getStreams };
