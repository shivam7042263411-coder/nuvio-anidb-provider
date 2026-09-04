// AniDB Provider for Nuvio
// Scrapes video sources from anidb.app
// Uses only regex parsing - compatible with Hermes/QuickJS runtime (no external deps)

var BASE = "https://anidb.app";
var AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function fetchText(url) {
    return fetch(url, {
        headers: {
            "User-Agent": AGENT,
            "Referer": BASE + "/"
        }
    }).then(function(res) {
        return res.text();
    });
}

function findAnimeByTmdb(tmdbId) {
    var url = BASE + "/search/suggestions?q=tmdb" + tmdbId;
    return fetchText(url)
    .then(function(html) {
        var slug = null;
        var re = /href="https:\/\/anidb\.app\/anime\/([a-z0-9-]+-[0-9]+)"/g;
        var m;
        while ((m = re.exec(html)) !== null) {
            slug = m[1];
            break;
        }
        return slug;
    });
}

function extractEpisodes(animeSlug) {
    var url = BASE + "/anime/" + animeSlug;
    return fetchText(url)
    .then(function(html) {
        var episodes = [];

        // Match episode data attributes in the episode list
        var re = /data-episode-id="([0-9]+)"[^>]*data-number="([0-9]+)"/g;
        var m;
        while ((m = re.exec(html)) !== null) {
            episodes.push({ id: m[1], number: parseInt(m[2]) });
        }

        // Fallback: parse episode server/embed links
        if (episodes.length === 0) {
            var re2 = /href="([^"]*\/watch\/[^"]*\/[0-9]+)"/g;
            while ((m = re2.exec(html)) !== null) {
                var numMatch = m[1].match(/\/([0-9]+)$/);
                if (numMatch) {
                    episodes.push({ number: parseInt(numMatch[1]), url: m[1] });
                }
            }
        }

        return episodes;
    });
}

function extractEmbedId(episodeId) {
    var url = BASE + "/ajax/episode/servers?episodeId=" + episodeId;
    return fetchText(url)
    .then(function(html) {
        // Find first embed/server id in the response
        var re = /data-id="([^"]+)"/;
        var m = html.match(re);
        return m ? m[1] : null;
    });
}

function extractM3u8(embedId) {
    var url = BASE + "/ajax/episode/sources?id=" + embedId;
    return fetchText(url)
    .then(function(html) {
        // Look for iframe src
        var frameRe = /src="([^"]+)"/;
        var frame = html.match(frameRe);
        if (!frame) return null;

        var embedUrl = frame[1];
        if (embedUrl.indexOf("http") !== 0) {
            embedUrl = BASE + embedUrl;
        }

        return fetchText(embedUrl);
    })
    .then(function(embedHtml) {
        if (!embedHtml) return null;

        // Extract hls.anidb.app master.m3u8 URL
        var re = /hls\.anidb\.app\/stream\/[^"'\s,)]+master\.m3u8/;
        var m = embedHtml.match(re);
        if (!m) return null;

        return "https://" + m[0];
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
    console.log("[AniDB] Fetching " + mediaType + " " + tmdbId);

    return findAnimeByTmdb(tmdbId)
    .then(function(slug) {
        if (!slug) {
            console.log("[AniDB] Could not find anime for TMDB ID " + tmdbId);
            return null;
        }
        console.log("[AniDB] Found anime slug: " + slug);
        return extractEpisodes(slug);
    })
    .then(function(episodes) {
        if (!episodes || episodes.length === 0) {
            console.log("[AniDB] No episodes found");
            return [];
        }

        var target = episodes.find(function(ep) {
            return ep.number === episode;
        });
        if (!target) {
            console.log("[AniDB] Episode " + episode + " not found");
            return [];
        }
        console.log("[AniDB] Found episode " + episode + " (id: " + target.id + ")");
        return target.id;
    })
    .then(function(episodeId) {
        if (!episodeId) return [];
        return extractEmbedId(episodeId);
    })
    .then(function(embedId) {
        if (!embedId) return [];
        return extractM3u8(embedId);
    })
    .then(function(streamUrl) {
        if (!streamUrl) {
            console.log("[AniDB] No stream URL extracted");
            return [];
        }
        console.log("[AniDB] Stream found: " + streamUrl);
        return [{
            name: "AniDB",
            title: "Episode " + episode,
            url: streamUrl,
            quality: "1080p",
            headers: {
                "Referer": "https://anidb.app/",
                "User-Agent": AGENT
            }
        }];
    })
    .catch(function(err) {
        console.error("[AniDB] Error:", err.message);
        return [];
    });
}

module.exports = { getStreams };