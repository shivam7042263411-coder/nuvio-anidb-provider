// Miruro (miruro.tv) Provider for Nuvio
// QuickJS compatible - no external deps.
//
// Calls miruro.tv's secure/pipe API directly. The request is base64(json) and the
// response is base64 + optionally gzip-compressed. Nuvio strips Accept-Encoding on
// native fetches, so responses may arrive uncompressed (identity); we also support
// gzip via a bundled pure-JS DEFLATE inflater just in case.
//
// Flow:
//   tmdbId -> ani.zip mapping -> anilist_id
//          -> pipe(episodes)  -> provider/category episode list
//          -> pipe(sources)   -> streams[].url (m3u8)

var MIRURO = "https://www.miruro.tv";
var ANIZIP = "https://api.ani.zip/mappings";
var AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fetchText(url, headers, method, body) {
    var opts = { headers: headers || {} };
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

// ---------- base64 <-> bytes ----------
var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64(str) {
    var s = String(str).replace(/[^A-Za-z0-9+/]/g, "");
    var out = [];
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < s.length; i++) {
        buffer = (buffer << 6) | B64_CHARS.indexOf(s[i]);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push((buffer >> bits) & 0xff);
        }
    }
    return out;
}

function encodeBase64Url(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i += 3) {
        var b0 = bytes[i];
        var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
        var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
        out += B64_CHARS[(b0 >> 2) & 63];
        out += B64_CHARS[((b0 << 4) | (b1 >> 4)) & 63];
        out += i + 1 < bytes.length ? B64_CHARS[((b1 << 2) | (b2 >> 6)) & 63] : "";
        out += i + 2 < bytes.length ? B64_CHARS[b2 & 63] : "";
    }
    return out;
}

// ---------- gzip / DEFLATE inflate (pure JS) ----------
// Huffman code construction + decode, following zlib puff.c (proven correct).
var MAXBITS = 15;

function constructHuffman(lengths, n) {
    var count = new Array(MAXBITS + 1).fill(0);
    for (var sym = 0; sym < n; sym++) count[lengths[sym]]++;
    if (count[0] === n) {
        return { count: count, symbol: [], max: 0 };
    }
    var left = 1;
    for (var len = 1; len <= MAXBITS; len++) {
        left <<= 1;
        left -= count[len];
        if (left < 0) return null;
    }
    var offsets = new Array(MAXBITS + 1).fill(0);
    for (var len2 = 1; len2 < MAXBITS; len2++) offsets[len2 + 1] = offsets[len2] + count[len2];
    var symbol = new Array(n);
    for (var sym2 = 0; sym2 < n; sym2++) {
        if (lengths[sym2] !== 0) symbol[offsets[lengths[sym2]]++] = sym2;
    }
    return { count: count, symbol: symbol, max: n };
}

var FIXED_HUFF = null;
function fixedHuffman() {
    if (FIXED_HUFF) return FIXED_HUFF;
    var lens = new Array(288);
    for (var i = 0; i < 144; i++) lens[i] = 8;
    for (var i = 144; i < 256; i++) lens[i] = 9;
    for (var i = 256; i < 280; i++) lens[i] = 7;
    for (var i = 280; i < 288; i++) lens[i] = 8;
    var dists = new Array(30);
    for (var j = 0; j < 30; j++) dists[j] = 5;
    FIXED_HUFF = { lit: constructHuffman(lens, 288), dist: constructHuffman(dists, 30) };
    return FIXED_HUFF;
}

var LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
var LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function inflate(bytes) {
    var bitPos = 0;
    var out = [];
    var lit = null;
    var dist = null;

    function bits(n) {
        var acc = 0;
        for (var i = 0; i < n; i++) {
            var b = (bytes[bitPos >> 3] || 0);
            var v = (b >> (bitPos & 7)) & 1;
            bitPos++;
            acc |= v << i;
        }
        return acc;
    }

    function decodeSym(h) {
        if (!h || h.max === 0) return -1;
        var code = 0;
        var first = 0;
        var index = 0;
        for (var len = 1; len <= MAXBITS; len++) {
            code |= bits(1);
            var count = h.count[len];
            if (code - first < count) {
                return h.symbol[index + (code - first)];
            }
            index += count;
            first += count;
            first <<= 1;
            code <<= 1;
        }
        return -1;
    }

    function copyOut(length, distance) {
        var start = out.length - distance;
        for (var k = 0; k < length; k++) {
            out.push(out[start + k]);
        }
    }

    var BFINAL = 0;
    while (!BFINAL) {
        BFINAL = bits(1);
        var BTYPE = bits(2);
        if (BTYPE === 0) {
            bitPos = (bitPos + 7) & ~7;
            var LEN = bits(16);
            bits(16); // NLEN (ignored)
            for (var i0 = 0; i0 < LEN; i0++) {
                out.push(bytes[bitPos >> 3]);
                bitPos += 8;
            }
        } else if (BTYPE === 1) {
            var fixed = fixedHuffman();
            lit = fixed.lit;
            dist = fixed.dist;
            while (true) {
                var symL = decodeSym(lit);
                if (symL < 256) {
                    out.push(symL);
                } else if (symL === 256) {
                    break;
                } else {
                    var li = symL - 257;
                    var length = LENGTH_BASE[li] + bits(LENGTH_EXTRA[li]);
                    var dsym = decodeSym(dist);
                    if (dsym < 0) return null;
                    var distance = DIST_BASE[dsym] + bits(DIST_EXTRA[dsym]);
                    copyOut(length, distance);
                }
            }
        } else if (BTYPE === 2) {
            var HLIT = bits(5) + 257;
            var HDIST = bits(5) + 1;
            var HCLEN = bits(4) + 4;
            var ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
            var clen = new Array(19).fill(0);
            for (var i1 = 0; i1 < HCLEN; i1++) clen[ORDER[i1]] = bits(3);
            var clTable = constructHuffman(clen, 19);
            if (!clTable) return null;
            var lens = new Array(HLIT + HDIST).fill(0);
            var ldx = 0;
            while (ldx < HLIT + HDIST) {
                var c = decodeSym(clTable);
                if (c < 0) return null;
                if (c < 16) {
                    lens[ldx++] = c;
                } else if (c === 16) {
                    var prev = ldx > 0 ? lens[ldx - 1] : 0;
                    var rep = 3 + bits(2);
                    for (var r = 0; r < rep; r++) lens[ldx++] = prev;
                } else if (c === 17) {
                    var repZ = 3 + bits(3);
                    for (var r2 = 0; r2 < repZ; r2++) lens[ldx++] = 0;
                } else {
                    var repZ2 = 11 + bits(7);
                    for (var r3 = 0; r3 < repZ2; r3++) lens[ldx++] = 0;
                }
            }
            var litLens = lens.slice(0, HLIT);
            var distLens = lens.slice(HLIT);
            lit = constructHuffman(litLens, HLIT);
            dist = constructHuffman(distLens, HDIST);
            if (!lit || !dist) return null;
            while (true) {
                var symL2 = decodeSym(lit);
                if (symL2 < 256) {
                    out.push(symL2);
                } else if (symL2 === 256) {
                    break;
                } else {
                    var li2 = symL2 - 257;
                    var len2 = LENGTH_BASE[li2] + bits(LENGTH_EXTRA[li2]);
                    var dsym2 = decodeSym(dist);
                    if (dsym2 < 0) return null;
                    var dist2 = DIST_BASE[dsym2] + bits(DIST_EXTRA[dsym2]);
                    copyOut(len2, dist2);
                }
            }
        } else {
            return null;
        }
    }
    return out;
}

function gunzip(bytes) {
    if (bytes.length < 10) return null;
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return null; // not gzip
    var xfl = bytes[3];
    var flags = bytes[3];
    if (flags & 0xe0) return null; // reserved
    var pos = 10;
    if (flags & 0x04) { pos += (bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 24)); pos += 4; }
    if (flags & 0x08) { while (bytes[pos] !== 0) pos++; pos++; }
    if (flags & 0x10) { while (bytes[pos] !== 0) pos++; pos++; }
    if (flags & 0x02) { pos += 2; }
    var deflated = bytes.slice(pos, bytes.length - 8);
    return inflate(deflated);
}

function bytesToText(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
        out += String.fromCharCode(bytes[i]);
    }
    return out;
}

// ---------- pipe API ----------
function pipeDecode(text) {
    var cleaned = String(text).replace(/\s+/g, "");
    var bytes = decodeBase64(cleaned);
    var tryGz = gunzip(bytes);
    if (tryGz) return safeJson(bytesToText(tryGz));
    return safeJson(bytesToText(bytes));
}

function pipeRequest(path, query) {
    var payload = {
        path: path,
        method: "GET",
        query: query,
        body: null,
        version: "0.1.0"
    };
    var json = JSON.stringify(payload);
    var reqBytes = [];
    for (var i = 0; i < json.length; i++) reqBytes.push(json.charCodeAt(i) & 0xff);
    var encoded = encodeBase64Url(reqBytes);
    var url = MIRURO + "/api/secure/pipe?e=" + encodeURIComponent(encoded);
    return fetchText(url, {
        "User-Agent": AGENT,
        "Referer": MIRURO + "/",
        "Origin": MIRURO,
        "Accept": "*/*",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty"
    }).then(pipeDecode);
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

function pickEpisode(data, episodeNum, wantDub) {
    if (!data || !data.providers) return null;
    var providers = data.providers;
    // Preferred source order
    var order = ["kiwi", "telli", "zoro", "hop", "arc", "jet", "pahe"];
    for (var o = 0; o < order.length; o++) {
        var prov = providers[order[o]];
        if (!prov || !prov.episodes) continue;
        var categories = ["sub", "dub"];
        var wantSub = wantDub ? "dub" : "sub";
        var list = prov.episodes[wantSub];
        if (!list || !list.length) list = prov.episodes.sub || prov.episodes.dub;
        if (!list) continue;
        for (var i = 0; i < list.length; i++) {
            if (Number(list[i].number) === Number(episodeNum)) {
                return {
                    provider: order[o],
                    category: wantSub,
                    episode: list[i],
                    baseUrl: MIRURO
                };
            }
        }
        // fallback: any episode id even if number mismatch
        for (var j = 0; j < list.length; j++) {
            return { provider: order[o], category: wantSub, episode: list[j], baseUrl: MIRURO };
        }
    }
    return null;
}

function makeStreams(item, title) {
    if (!item || !item.streams || !item.streams.length) return [];
    var out = [];
    var seen = {};
    for (var i = 0; i < item.streams.length; i++) {
        var s = item.streams[i];
        if (!s || !s.url || seen[s.url]) continue;
        seen[s.url] = true;
        var q = 0;
        var qm = String(s.quality || "").match(/(2160|1440|1080|720|480|360)/);
        if (qm) q = parseInt(qm[1], 10);
        if (!q) q = 1080;
        out.push({
            name: "Miruro " + (item.providerLabel || "HLS") + (s.quality ? " " + s.quality : ""),
            title: title,
            url: s.url,
            quality: q,
            headers: {
                "Referer": MIRURO + "/",
                "User-Agent": AGENT
            }
        });
    }
    return out;
}

function getStreams(tmdbId, mediaType, season, episode) {
    season = Number(season) || 1;
    episode = Number(episode) || 1;
    if (mediaType === "movie") episode = 1;

    return mapAnilistFromTmdb(tmdbId)
        .then(function(anilistId) {
            if (!anilistId) return [];
            return pipeRequest("episodes", { anilistId: Number(anilistId) }).then(function(data) {
                var picked = pickEpisode(data, episode, false);
                if (!picked) return [];
                var epId = picked.episode.id;
                // Some providers give the episodeId inline; mirror the frontend secret encoding
                var encId = encodeBase64Url(strToBytes(String(epId)));
                return pipeRequest("sources", {
                    episodeId: encId,
                    provider: picked.provider,
                    category: picked.category,
                    anilistId: Number(anilistId)
                }).then(function(src) {
                    if (src && typeof src === "object") src.providerLabel = picked.provider;
                    var title = (mediaType === "movie" ? "Movie" : "S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0"));
                    return makeStreams(src, title);
                });
            });
        })
        .catch(function() {
            return [];
        });
}

function strToBytes(str) {
    var out = new Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
}

module.exports = { getStreams };
