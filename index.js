/**
 * Host half of dsh-bili-mini.
 *
 * Routes:
 *   GET  /bili-mini/api/feed?refresh=1&...   recommendation list
 *   GET  /bili-mini/api/history                latest 30 watch-history entries
 *   POST /bili-mini/api/history/report         report playback progress (silent on failure)
 *   GET  /bili-mini/api/play?contentKey=...&cid=...
 *                                              play metadata + proxied stream + danmaku
 *                                              (legacy ?bvid=... and ?epid=... still work)
 *   GET  /bili-mini/stream/<token>            range-aware media proxy
 *   GET  /bili-mini/api/login/qr              Bilibili QR code + qrcode_key
 *   GET  /bili-mini/api/login/poll?key=...    scan status (writes cookie on success)
 *   GET  /bili-mini/api/login/status          local login state
 *   DELETE /bili-mini/api/login               remove data/cookie.json
 *   GET  /bili-mini/vendor/artplayer.js       vendored player bundle
 *   GET  /bili-mini/vendor/artplayer-plugin-danmuku.js
 *                                             vendored danmaku plugin
 *
 * The browser never sees a Bilibili CDN URL: `/api/play` resolves it and
 * returns an opaque, short-lived token; `/stream/<token>` adds the Referer and
 * User-Agent Bilibili requires, forwards Range, and pipes the body through.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  BILI_UA,
  fetchHistory,
  fetchPlayUrl,
  fetchMp4PlayUrl,
  fetchPgcPlayUrl,
  fetchPgcSeason,
  fetchRecommendations,
  fetchVideoView,
  parseContentKey,
  reportPgcHistory,
  reportVideoHistory,
} from './bili.js';
import { fetchDanmaku } from './danmaku.js';
import {
  generateQr,
  loadSession,
  loginStatus,
  logout,
  pollQr,
  redact,
} from './auth.js';

export const name = 'dsh-bili-mini';
export const inject = ['webServer'];

const PREFIX = '/bili-mini';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STREAM_TOKEN_TTL_MS = 3 * 60 * 60_000;
const PLAY_CACHE_TTL_MS = 5 * 60_000;
const MAX_STREAMS = 200;
const MAX_DASH_MANIFESTS = 100;
const MAX_PLAY_CACHE = 100;
const CONNECT_TIMEOUT_MS = 15_000;

const QUALITY_LABELS = new Map([
  [120, '4K'],
  [116, '1080P60'],
  [112, '1080P+'],
  [80, '1080P'],
  [74, '720P60'],
  [64, '720P'],
  [32, '480P'],
  [16, '360P'],
]);
const SUPPORTED_QN = new Set([64, 80, 112]);

const ARTPLAYER_JS = readAsset('vendor', 'artplayer.js');
const DANMAKU_PLUGIN_JS = readAsset('vendor', 'artplayer-plugin-danmuku.js');
const DASH_JS = readAsset('vendor', 'dash.all.min.js');
const VENDOR_ASSETS = new Map([
  [`${PREFIX}/vendor/artplayer.js`, ARTPLAYER_JS],
  [`${PREFIX}/vendor/artplayer-plugin-danmuku.js`, DANMAKU_PLUGIN_JS],
  [`${PREFIX}/vendor/dash.js`, DASH_JS],
]);

function readAsset(...segments) {
  try {
    return fs.readFileSync(path.join(HERE, ...segments));
  } catch {
    return null;
  }
}

export function apply(ctx, config = {}) {
  const size = clampInt(config.feedSize, 12, 1, 20);
  const ttl = clampInt(config.cacheTtlMs, 60_000, 5_000, 10 * 60_000);

  let cache = { key: '', at: 0, items: [], personalized: false };
  let feedGeneration = 0;
  /**
   * Bilibili returns the same batch for the same `fresh_idx`, so every real
   * upstream fetch advances this cursor. Cache hits do not advance it.
   */
  let freshIndex = 0;

  /** Opaque stream tokens -> resolved Bilibili URL. */
  const streams = new Map();
  /** sessionKey:bvid:cid:qn -> play metadata, isolated per account and quality. */
  const playCache = new Map();
  /** Opaque manifest tokens -> generated MPD XML. */
  const dashManifests = new Map();

  async function loadFeed(force = false) {
    const session = loadSession();
    const cookies = session?.cookies || null;
    const personalized = Boolean(cookies?.SESSDATA);
    // The hash keeps the cache scoped per account without storing the cookie
    // in a cache key, log, or response.
    const sessionKey = cookieSessionKey(cookies);

    if (
      !force &&
      cache.key === sessionKey &&
      cache.items.length > 0 &&
      Date.now() - cache.at < ttl
    ) {
      return {
        items: cache.items,
        cached: true,
        fetchedAt: cache.at,
        personalized: cache.personalized,
      };
    }

    // A login/logout can race with an in-flight anonymous fetch. The generation
    // token makes sure only the newest request writes the cache.
    const generation = ++feedGeneration;
    freshIndex += 1;
    const requestIndex = freshIndex;
    const items = await fetchRecommendations({
      size,
      freshIndex: requestIndex,
      cookies,
    });

    if (generation !== feedGeneration) {
      return {
        items: cache.items,
        cached: true,
        fetchedAt: cache.at,
        personalized: cache.personalized,
      };
    }

    cache = {
      key: sessionKey,
      at: Date.now(),
      items,
      personalized,
    };
    return {
      items: cache.items,
      cached: false,
      fetchedAt: cache.at,
      personalized: cache.personalized,
    };
  }

  function rememberStream(upstreamUrl, contentType = '') {
    if (!isAllowedStreamUrl(upstreamUrl)) {
      throw new Error('B 站返回了不受支持的流地址');
    }

    const now = Date.now();

    for (const [key, value] of streams) {
      if (value.expiresAt <= now) streams.delete(key);
    }
    while (streams.size >= MAX_STREAMS) {
      const oldest = streams.keys().next().value;
      if (oldest === undefined) break;
      streams.delete(oldest);
    }

    const id = randomUUID();
    streams.set(id, {
      url: upstreamUrl,
      contentType,
      expiresAt: now + STREAM_TOKEN_TTL_MS,
    });
    return `${PREFIX}/stream/${id}`;
  }

  function rememberDashManifest(xml) {
    const now = Date.now();
    for (const [key, value] of dashManifests) {
      if (value.expiresAt <= now) dashManifests.delete(key);
    }
    while (dashManifests.size >= MAX_DASH_MANIFESTS) {
      const oldest = dashManifests.keys().next().value;
      if (oldest === undefined) break;
      dashManifests.delete(oldest);
    }
    const id = randomUUID();
    dashManifests.set(id, {
      xml,
      expiresAt: now + STREAM_TOKEN_TTL_MS,
    });
    return `${PREFIX}/dash/${id}`;
  }

  function prunePlayCache() {
    const now = Date.now();
    for (const [key, value] of playCache) {
      if (now - value.at >= PLAY_CACHE_TTL_MS) playCache.delete(key);
    }
    while (playCache.size > MAX_PLAY_CACHE) {
      const oldest = playCache.keys().next().value;
      if (oldest === undefined) break;
      playCache.delete(oldest);
    }
  }

  /**
   * Build the DASH response shared by UGC (logged in) and PGC (either login
   * state). This is a pure move of the previous inline UGC block; the field
   * set and order of fallbacks are unchanged.
   */
  function buildDashPlayData({ baseData, play, qn, requestedQn }) {
    const videoTrack = selectDashVideo(play.dash, qn);
    const audioTrack = selectDashAudio(play.dash);
    if (!videoTrack || !audioTrack) {
      throw new Error('B 站没有返回可播放的 DASH 流');
    }
    if (
      !videoTrack.initRange ||
      !videoTrack.indexRange ||
      !audioTrack.initRange ||
      !audioTrack.indexRange
    ) {
      throw new Error('B 站 DASH 流缺少 SegmentBase 范围');
    }

    const videoUrl = rememberStream(
      videoTrack.baseUrl,
      videoTrack.mimeType || 'video/mp4',
    );
    const audioUrl = rememberStream(
      audioTrack.baseUrl,
      audioTrack.mimeType || 'audio/mp4',
    );
    const dashDuration = play.dash.duration || baseData.duration || 0;
    const manifestXml = buildDashManifest({
      duration: dashDuration,
      minBufferTime: play.dash.minBufferTime,
      video: videoTrack,
      audio: audioTrack,
      videoUrl,
      audioUrl,
    });
    const manifestUrl = rememberDashManifest(manifestXml);
    const availableQualities = listAvailableQualities(play.dash);

    return {
      ...baseData,
      mode: 'dash',
      manifest: {
        url: manifestUrl,
        mime: 'application/dash+xml',
      },
      quality: videoTrack.id,
      qualityLabel: qualityLabel(videoTrack.id),
      qualityLocked: requestedQn > 64,
      availableQualities,
      acceptQuality: play.acceptQuality,
      acceptDescription: play.acceptDescription,
      dashDuration: Number(dashDuration) || 0,
      format: 'dash',
    };
  }

  /**
   * Build the progressive-MP4 response used by anonymous UGC playback. Pure
   * move of the previous inline block.
   */
  function buildMp4PlayData({ baseData, play, requestedQn }) {
    const segment = play.segments?.[0];
    if (!segment) throw new Error('B 站没有返回可播放的视频流');
    const availableQualities = [
      ...new Set([play.quality, ...play.acceptQuality]),
    ]
      .filter(
        (quality) =>
          quality > 0 &&
          (SUPPORTED_QN.has(quality) || quality === play.quality),
      )
      .sort((a, b) => b - a)
      .map((quality) => ({ qn: quality, label: qualityLabel(quality) }));

    return {
      ...baseData,
      mode: 'mp4',
      stream: {
        url: rememberStream(segment.url, 'video/mp4'),
        size: segment.size,
        durationMs: segment.durationMs,
      },
      quality: play.quality,
      qualityLabel: qualityLabel(play.quality),
      qualityLocked: requestedQn > 64,
      availableQualities,
      acceptQuality: play.acceptQuality,
      acceptDescription: play.acceptDescription,
      format: play.format,
    };
  }

  async function loadPlay(contentKey, requestedCid, force, options = {}) {
    const {
      qn = 64,
      requestedQn = qn,
      cookies = null,
      loggedIn = false,
      sessionKey = 'anon',
    } = options;
    const parsed = parseContentKey(contentKey);
    if (!parsed) throw new Error('invalid contentKey');
    const key = `${sessionKey}:${parsed.contentKey}:${requestedCid || 0}:${qn}`;
    const hit = playCache.get(key);
    if (!force && hit && Date.now() - hit.at < PLAY_CACHE_TTL_MS) {
      return { ...hit.data, cached: true };
    }
    if (force) playCache.delete(key);

    let cid = 0;
    let aid = 0;
    let title = '';
    let duration = 0;
    let cover = '';
    let owner = { name: '' };
    let seasonId = 0;
    let seasonTitle = '';
    let episodes = [];
    let playPromise;

    if (parsed.kind === 'pgc') {
      const season = await fetchPgcSeason(parsed.epid, { cookies });
      const episode = season.episode;
      cid = episode.cid;
      aid = episode.aid;
      title =
        [season.title, episode.title].filter(Boolean).join(' · ') ||
        episode.title ||
        '番剧';
      duration = episode.duration || 0;
      cover = episode.cover || season.cover;
      owner = season.owner;
      seasonId = season.seasonId;
      seasonTitle = season.title;
      // Keep the selector DTO small: the season payload also carries aid,
      // bvid, covers and publish times that the episode picker does not need.
      episodes = season.episodes.map((entry) => ({
        epid: entry.epid,
        cid: entry.cid,
        title: entry.title,
        duration: entry.duration,
      }));
      playPromise = fetchPgcPlayUrl(parsed.epid, cid, { qn, cookies });
    } else {
      const view = await fetchVideoView(parsed.bvid);
      if (!view.cid) throw new Error('没有找到该视频的 cid');

      const page = requestedCid > 0
        ? view.pages.find((entry) => entry.cid === requestedCid)
        : undefined;
      cid = page?.cid ?? view.cid;
      aid = view.aid;
      title = page?.part || view.title;
      duration = page?.duration || view.duration;
      cover = view.cover;
      owner = view.owner;
      playPromise = loggedIn
        ? fetchPlayUrl(parsed.bvid, cid, { qn, cookies })
        : fetchMp4PlayUrl(parsed.bvid, cid, { qn: 64, cookies: null });
    }

    const [play, danmaku] = await Promise.all([
      playPromise,
      fetchDanmaku(cid, { limit: 1000, timeoutMs: 4000 })
        .then((items) => ({ items, error: '' }))
        .catch((error) => ({ items: [], error: error.message })),
    ]);

    if (danmaku.error) {
      ctx.logger?.warn?.(
        `[bili-mini] danmaku ${cid} failed: ${redact(danmaku.error)}`,
      );
    }

    if (parsed.kind === 'pgc' && !duration) {
      duration = Number(play.duration) || 0;
    }

    const baseData = {
      kind: parsed.kind,
      contentKey: parsed.contentKey,
      aid,
      ...(parsed.kind === 'ugc'
        ? { bvid: parsed.bvid }
        : { epid: parsed.epid, seasonId, seasonTitle, episodes }),
      cid,
      title,
      duration,
      cover,
      owner,
      requestedQn,
      qn,
      loggedIn,
      danmaku: danmaku.items,
      ...(danmaku.error ? { danmakuError: danmaku.error } : {}),
      fetchedAt: Date.now(),
    };

    let data;
    if (parsed.kind === 'pgc' || loggedIn) {
      data = buildDashPlayData({ baseData, play, qn, requestedQn });
    } else {
      data = buildMp4PlayData({ baseData, play, requestedQn });
    }

    // A failed danmaku fetch should not pin playback to an empty comment list
    // for the whole TTL; a later open retries both view/playurl and danmaku.
    if (!danmaku.error) {
      playCache.set(key, { at: Date.now(), data });
      prunePlayCache();
    }
    return { ...data, cached: false };
  }

  async function handleDash(req, res, id) {
    setMediaCors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }

    const entry = dashManifests.get(id);
    if (!entry || entry.expiresAt <= Date.now()) {
      dashManifests.delete(id);
      sendJson(res, 404, { ok: false, error: 'dash manifest expired' });
      return;
    }

    const origin = requestOrigin(req);
    const xml = origin
      ? entry.xml.replace(
          /<BaseURL>(\/bili-mini\/stream\/[^<]+)<\/BaseURL>/g,
          (_, path) => `<BaseURL>${origin}${path}</BaseURL>`,
        )
      : entry.xml;
    const body = Buffer.from(xml, 'utf8');
    res.writeHead(200, {
      'content-type': 'application/dash+xml; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function handleStream(req, res, id) {
    setMediaCors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }

    const entry = streams.get(id);
    if (!entry || entry.expiresAt <= Date.now()) {
      streams.delete(id);
      sendJson(res, 404, { ok: false, error: 'stream token expired' });
      return;
    }

    const controller = new AbortController();
    const connectTimer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    const isHead = req.method === 'HEAD';
    // Some Bilibili CDN edges answer HEAD with 404. A one-byte GET gives the
    // same metadata and keeps the media seekable in Chromium's eyes.
    const range = typeof req.headers.range === 'string'
      ? req.headers.range
      : isHead
        ? 'bytes=0-0'
        : '';
    let upstream;

    try {
      upstream = await fetch(entry.url, {
        method: isHead ? 'GET' : req.method,
        headers: {
          'User-Agent': BILI_UA,
          Referer: 'https://www.bilibili.com/',
          Origin: 'https://www.bilibili.com',
          Accept: '*/*',
          ...(range ? { Range: range } : {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      sendJson(res, 504, {
        ok: false,
        error: `B 站流连接失败：${error.message}`,
      });
      return;
    } finally {
      clearTimeout(connectTimer);
    }

    if (upstream.status !== 200 && upstream.status !== 206 && upstream.status !== 416) {
      const detail = await upstream.text().catch(() => '');
      ctx.logger?.warn?.(
        `[bili-mini] stream upstream HTTP ${upstream.status}: ${
          redact(detail.slice(0, 200))
        }`,
      );
      sendJson(res, 502, {
        ok: false,
        error: `B 站流请求失败（HTTP ${upstream.status}）`,
      });
      return;
    }

    if (isHead) {
      const total =
        contentRangeTotal(upstream.headers.get('content-range')) ||
        upstream.headers.get('content-length') ||
        '';
      const headHeaders = {
        'content-type':
          entry.contentType ||
          upstream.headers.get('content-type') ||
          'video/mp4',
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      };
      if (total) headHeaders['content-length'] = total;
      for (const name of ['last-modified', 'etag']) {
        const value = upstream.headers.get(name);
        if (value) headHeaders[name] = value;
      }
      res.writeHead(200, headHeaders);
      if (upstream.body) await upstream.body.cancel().catch(() => {});
      res.end();
      return;
    }

    const headers = {
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    };
    for (const header of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'last-modified',
      'etag',
    ]) {
      const value = upstream.headers.get(header);
      if (value) headers[header] = value;
    }
    if (entry.contentType) headers['content-type'] = entry.contentType;
    else if (!headers['content-type']) headers['content-type'] = 'video/mp4';

    res.writeHead(upstream.status, headers);

    if (req.method === 'HEAD' || !upstream.body) {
      if (upstream.body) await upstream.body.cancel().catch(() => {});
      res.end();
      return;
    }

    const body = Readable.fromWeb(upstream.body);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      controller.abort();
      body.destroy();
    };

    res.on('close', cleanup);
    body.on('error', cleanup);
    body.pipe(res);
  }

  function handleVendor(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }

    const asset = VENDOR_ASSETS.get(pathname);
    if (!asset) {
      sendJson(res, 404, { ok: false, error: 'vendor asset is missing' });
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'content-length': asset.length,
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : asset);
  }

  const disposeRoute = ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      try {
        if (url.pathname === `${PREFIX}/api/feed`) {
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' });
            return;
          }

          // An explicit refresh bypasses the TTL so the button always advances
          // the Bilibili cursor instead of replaying the cached batch.
          const force = url.searchParams.get('refresh') === '1';
          const feed = await loadFeed(force);
          sendJson(res, 200, { ok: true, ...feed });
          return;
        }

        if (url.pathname === `${PREFIX}/api/history`) {
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' });
            return;
          }
          const session = loadSession();
          if (!session?.cookies?.SESSDATA) {
            sendJson(res, 401, {
              ok: false,
              error: 'login required',
              needsLogin: true,
            });
            return;
          }
          let history;
          try {
            history = await fetchHistory({
              size: 30,
              cookies: session.cookies,
            });
          } catch (error) {
            if (String(error?.message || '').includes('-101')) {
              sendJson(res, 401, {
                ok: false,
                error: 'login required',
                needsLogin: true,
              });
              return;
            }
            throw error;
          }
          sendJson(res, 200, { ok: true, ...history });
          return;
        }

        if (url.pathname === `${PREFIX}/api/history/report`) {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' });
            return;
          }
          if (
            !String(req.headers['content-type'] || '').includes(
              'application/json',
            )
          ) {
            sendJson(res, 415, {
              ok: false,
              error: 'unsupported media type',
            });
            return;
          }

          let body;
          try {
            body = await readJsonBody(req);
          } catch {
            sendJson(res, 400, { ok: false, error: 'invalid body' });
            return;
          }

          const session = loadSession();
          if (!session?.cookies?.SESSDATA || !session.cookies.bili_jct) {
            sendJson(res, 200, {
              ok: true,
              synced: false,
              skipped: 'login',
            });
            return;
          }

          const parsedKey = parseContentKey(
            typeof body?.contentKey === 'string' ? body.contentKey : '',
          );
          // contentKey is authoritative; the explicit kind is the fallback for
          // older callers, and presence of epid is the final legacy hint.
          const kind =
            parsedKey?.kind ||
            (body?.kind === 'pgc' || body?.kind === 'ugc'
              ? body.kind
              : '') ||
            (body?.epid ? 'pgc' : 'ugc');

          const playedTime = clampInt(body?.playedTime, 0, 0, 86_400);
          const realPlayedTime = clampInt(
            body?.realPlayedTime,
            playedTime,
            0,
            86_400,
          );
          const startTs = clampInt(body?.startTs, 0, 0, 4_000_000_000);
          const event = ['start', 'heartbeat', 'pause', 'end', 'close'].includes(
            body?.event,
          )
            ? body.event
            : 'heartbeat';

          if (kind === 'pgc') {
            const epid =
              normalizeEpid(body?.epid) ||
              (parsedKey?.kind === 'pgc' ? parsedKey.epid : 0);
            const seasonId = normalizeCid(body?.sid ?? body?.seasonId);
            const cid = normalizeCid(body?.cid);
            if (!epid || !seasonId || !cid) {
              sendJson(res, 200, {
                ok: true,
                synced: false,
                skipped: 'invalid',
              });
              return;
            }

            try {
              await reportPgcHistory({
                cookies: session.cookies,
                epid,
                seasonId,
                cid,
                aid: Number(body?.aid) || 0,
                progress: playedTime,
                startTs,
                realPlayedTime,
                event,
              });
              sendJson(res, 200, { ok: true, synced: true });
            } catch (error) {
              // Playback must never be interrupted by a history write failure.
              ctx.logger?.warn?.(
                `[bili-mini] pgc history sync skipped: ${
                  redact(error?.message || error)
                }`,
              );
              sendJson(res, 200, { ok: true, synced: false });
            }
            return;
          }

          const bvid =
            normalizeBvid(body?.bvid) ||
            (parsedKey?.kind === 'ugc' ? parsedKey.bvid : '');
          const aid = Number(body?.aid);
          const cid = normalizeCid(body?.cid);
          if (
            !bvid ||
            !Number.isSafeInteger(aid) ||
            aid <= 0 ||
            cid <= 0
          ) {
            sendJson(res, 200, {
              ok: true,
              synced: false,
              skipped: 'invalid',
            });
            return;
          }

          try {
            await reportVideoHistory({
              cookies: session.cookies,
              aid,
              bvid,
              cid,
              progress: playedTime,
              startTs,
              realPlayedTime,
              event,
            });
            sendJson(res, 200, { ok: true, synced: true });
          } catch (error) {
            // Playback must never be interrupted by a history write failure.
            ctx.logger?.warn?.(
              `[bili-mini] history sync skipped: ${
                redact(error?.message || error)
              }`,
            );
            sendJson(res, 200, { ok: true, synced: false });
          }
          return;
        }

        if (url.pathname === `${PREFIX}/api/play`) {
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' });
            return;
          }

          const rawContentKey = url.searchParams.get('contentKey');
          const rawBvid = url.searchParams.get('bvid');
          const rawEpid = url.searchParams.get('epid');

          let requested = null;
          if (rawContentKey !== null) {
            requested = parseContentKey(rawContentKey);
          } else if (rawBvid !== null) {
            const bvid = normalizeBvid(rawBvid);
            if (bvid) {
              requested = { kind: 'ugc', bvid, contentKey: bvid };
            }
          } else if (rawEpid !== null) {
            const epid = normalizeEpid(rawEpid);
            if (epid) {
              requested = {
                kind: 'pgc',
                epid,
                contentKey: `pgc:${epid}`,
              };
            }
          }

          if (!requested) {
            const error =
              rawContentKey !== null
                ? 'invalid contentKey'
                : rawBvid !== null
                  ? 'invalid bvid'
                  : rawEpid !== null
                    ? 'invalid epid'
                    : 'invalid contentKey';
            sendJson(res, 400, { ok: false, error });
            return;
          }

          const requestedCid = normalizeCid(url.searchParams.get('cid'));
          const force = url.searchParams.get('refresh') === '1';
          const session = loadSession();
          const cookies = session?.cookies || null;
          const loggedIn = Boolean(cookies?.SESSDATA);
          const requestedQn = normalizeQn(url.searchParams.get('qn'));
          const qn = loggedIn ? requestedQn : 64;
          const sessionKey = cookieSessionKey(cookies);
          const data = await loadPlay(
            requested.contentKey,
            requestedCid,
            force,
            {
              qn,
              requestedQn,
              cookies,
              loggedIn,
              sessionKey,
            },
          );
          // These fields describe this request, not the cached play record.
          sendJson(res, 200, {
            ok: true,
            ...data,
            requestedQn,
            qn,
            loggedIn,
            qualityLocked: !loggedIn && requestedQn > 64,
          });
          return;
        }

        if (url.pathname.startsWith(`${PREFIX}/stream/`)) {
          const id = url.pathname.slice(`${PREFIX}/stream/`.length);
          await handleStream(req, res, id);
          return;
        }

        if (url.pathname.startsWith(`${PREFIX}/dash/`)) {
          const id = url.pathname.slice(`${PREFIX}/dash/`.length);
          await handleDash(req, res, id);
          return;
        }

        if (VENDOR_ASSETS.has(url.pathname)) {
          handleVendor(req, res, url.pathname);
          return;
        }

        if (url.pathname === `${PREFIX}/api/login/qr`) {
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' });
            return;
          }
          const qr = await generateQr();
          sendJson(res, 200, { ok: true, ...qr });
          return;
        }

        if (url.pathname === `${PREFIX}/api/login/poll`) {
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' });
            return;
          }
          const key = url.searchParams.get('key') || '';
          if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
            sendJson(res, 400, { ok: false, error: 'invalid key' });
            return;
          }
          const result = await pollQr(key);
          sendJson(res, 200, { ok: true, ...result });
          return;
        }

        if (url.pathname === `${PREFIX}/api/login/status`) {
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' });
            return;
          }
          sendJson(res, 200, { ok: true, ...loginStatus() });
          return;
        }

        if (url.pathname === `${PREFIX}/api/login`) {
          if (req.method !== 'DELETE') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' });
            return;
          }
          logout();
          sendJson(res, 200, { ok: true, loggedIn: false });
          return;
        }

        sendJson(res, 404, { ok: false, error: 'not found' });
      } catch (error) {
        const message = redact(error?.message || error);
        ctx.logger?.warn?.(`[bili-mini] ${url.pathname} failed: ${message}`);
        if (res.headersSent) {
          res.destroy();
        } else {
          sendJson(res, 502, { ok: false, error: message });
        }
      }
    },
  });

  if (!ARTPLAYER_JS) {
    ctx.logger?.warn?.('[bili-mini] vendor/artplayer.js is missing; player will not load');
  }
  if (!DANMAKU_PLUGIN_JS) {
    ctx.logger?.warn?.(
      '[bili-mini] vendor/artplayer-plugin-danmuku.js is missing; danmaku will not load',
    );
  }
  ctx.logger?.info?.(`[bili-mini] routes ready under ${PREFIX}`);

  ctx.effect(() => () => {
    try {
      disposeRoute();
    } catch {
      // The route table is already gone when the webserver unloads first.
    }
  });
}

function readJsonBody(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        fail(new Error('body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', fail);
  });
}

/** Media routes are loaded by dash.js via XHR from the custom dsh-app origin. */
function setMediaCors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, HEAD, OPTIONS');
  res.setHeader(
    'access-control-allow-headers',
    'Range, Origin, Accept, Content-Type, If-Range',
  );
  res.setHeader(
    'access-control-expose-headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag, Last-Modified',
  );
  res.setHeader('access-control-max-age', '86400');
}

function requestOrigin(req) {
  const host = req.headers.host;
  if (!host) return '';
  const forwarded = req.headers['x-forwarded-proto'];
  const proto =
    typeof forwarded === 'string' && forwarded
      ? forwarded.split(',')[0].trim()
      : 'http';
  return `${proto}://${host}`;
}

function sendJson(res, status, body) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(data);
}

function normalizeBvid(value) {
  const text = String(value ?? '').trim();
  return /^BV[0-9A-Za-z]{10}$/.test(text) ? text : '';
}

/** PGC episode ids are positive integers; reject floats/exponents. */
function normalizeEpid(value) {
  const text = typeof value === 'number'
    ? String(value)
    : String(value ?? '').trim();
  if (!/^\d{1,20}$/.test(text)) return 0;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function normalizeCid(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** Restrict qn to the qualities this plugin understands; default 720P. */
function normalizeQn(value) {
  const n = Number(value);
  return SUPPORTED_QN.has(n) ? n : 64;
}

/** Cache key scope: account hash, never the raw SESSDATA. */
function cookieSessionKey(cookies) {
  if (!cookies?.SESSDATA) return 'anon';
  return `user:${createHash('sha256').update(cookies.SESSDATA).digest('hex').slice(0, 16)}`;
}

function qualityLabel(quality) {
  return QUALITY_LABELS.get(quality) ?? (quality ? `Q${quality}` : '未知');
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[<>&"']/g, (char) => {
    switch (char) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      default: return '&apos;';
    }
  });
}

function segmentBaseXml(track) {
  const indexRange = track.indexRange;
  const initRange = track.initRange;
  if (!indexRange && !initRange) return '';
  const indexAttr = indexRange
    ? ` indexRange="${xmlEscape(indexRange)}"`
    : '';
  const init = initRange
    ? `<Initialization range="${xmlEscape(initRange)}"/>`
    : '';
  return `<SegmentBase${indexAttr}>${init}</SegmentBase>`;
}

function buildDashManifest({
  duration,
  minBufferTime,
  video,
  audio,
  videoUrl,
  audioUrl,
}) {
  const seconds = Math.max(1, Math.round(Number(duration) || 1));
  const buffer = Math.max(0.5, Number(minBufferTime) || 1.5);
  const videoMime = video.mimeType || 'video/mp4';
  const audioMime = audio.mimeType || 'audio/mp4';
  const videoAttrs = [
    `id="${video.id}"`,
    `bandwidth="${Math.max(1, video.bandwidth)}"`,
    `codecs="${xmlEscape(video.codecs || 'avc1.640033')}"`,
    `width="${video.width}"`,
    `height="${video.height}"`,
    video.frameRate ? `frameRate="${xmlEscape(video.frameRate)}"` : '',
    video.sar ? `sar="${xmlEscape(video.sar)}"` : '',
  ].filter(Boolean).join(' ');
  const audioAttrs = [
    `id="${audio.id}"`,
    `bandwidth="${Math.max(1, audio.bandwidth)}"`,
    `codecs="${xmlEscape(audio.codecs || 'mp4a.40.2')}"`,
  ].join(' ');

  return `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" mediaPresentationDuration="PT${seconds}S" minBufferTime="PT${buffer}S">
  <Period id="0" start="PT0S">
    <AdaptationSet id="0" contentType="video" mimeType="${xmlEscape(videoMime)}" segmentAlignment="true" startWithSap="1">
      <Representation ${videoAttrs}>
        <BaseURL>${xmlEscape(videoUrl)}</BaseURL>
        ${segmentBaseXml(video)}
      </Representation>
    </AdaptationSet>
    <AdaptationSet id="1" contentType="audio" mimeType="${xmlEscape(audioMime)}" segmentAlignment="true" startWithSap="0">
      <Representation ${audioAttrs}>
        <BaseURL>${xmlEscape(audioUrl)}</BaseURL>
        ${segmentBaseXml(audio)}
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
}

function selectDashVideo(dash, qn) {
  if (!dash?.video?.length) return null;
  const avc = dash.video.filter(
    (track) =>
      track.baseUrl &&
      track.id > 0 &&
      track.codecid === 7 &&
      track.width > 0 &&
      track.height > 0,
  );
  const pool = avc.length
    ? avc
    : dash.video.filter((track) => track.baseUrl && track.id > 0);
  if (pool.length === 0) return null;
  const exact = pool.find((track) => track.id === qn);
  if (exact) return exact;
  const lower = pool
    .filter((track) => track.id <= qn)
    .sort((a, b) => b.id - a.id)[0];
  return lower || [...pool].sort((a, b) => b.id - a.id)[0];
}

function selectDashAudio(dash) {
  const pool = (dash?.audio || []).filter(
    (track) => track.baseUrl && track.mimeType.startsWith('audio/'),
  );
  return pool.sort((a, b) => b.bandwidth - a.bandwidth)[0] || null;
}

function listAvailableQualities(dash) {
  const pool = (dash?.video || []).filter(
    (track) =>
      track.baseUrl &&
      track.id > 0 &&
      track.codecid === 7 &&
      track.width > 0 &&
      track.height > 0,
  );
  const ids = [...new Set(pool.map((track) => track.id))]
    .filter((id) => SUPPORTED_QN.has(id))
    .sort((a, b) => b - a);
  return ids.map((id) => ({ qn: id, label: qualityLabel(id) }));
}

/** Total byte count from a `Content-Range: bytes a-b/total` value. */
function contentRangeTotal(value) {
  if (typeof value !== 'string') return '';
  const match = /\/(\d+)\s*$/.exec(value);
  return match ? match[1] : '';
}

/** Only Bilibili CDN origins resolved by playurl are ever proxied. */
function isAllowedStreamUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  return ['bilivideo.com', 'bilivideo.cn', 'hdslb.com', 'bilibili.com', 'akamaized.net']
    .some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}
