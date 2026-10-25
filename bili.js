/**
 * Bilibili API helpers.
 *
 * The recommendation feed returns `data.item[]` with `pic` as its cover field.
 * It is anonymous by default; when the caller passes the local login cookies,
 * the same endpoint returns the personalized feed. The UGC play flow uses the
 * public view endpoint for `cid`, DASH (`fnval=16`) for logged-in 720P/1080P,
 * and progressive MP4 (`fnval=1`) as the anonymous 720P fallback.
 *
 * PGC (bangumi/TV) is a separate API family: the season is resolved with
 * `/pgc/view/web/season?ep_id=`, streams come from
 * `/pgc/player/web/playurl?ep_id=&cid=`, and both put their payload under
 * `result` instead of `data`. PGC progress uses the web heartbeat with
 * `type=4`; `/x/v2/history/report` does not understand `epid`.
 */

const FEED_ENDPOINT = 'https://api.bilibili.com/x/web-interface/index/top/feed/rcmd';
const VIEW_ENDPOINT = 'https://api.bilibili.com/x/web-interface/view';
const PLAYURL_ENDPOINT = 'https://api.bilibili.com/x/player/playurl';
const PGC_SEASON_ENDPOINT = 'https://api.bilibili.com/pgc/view/web/season';
const PGC_PLAYURL_ENDPOINT = 'https://api.bilibili.com/pgc/player/web/playurl';
const HISTORY_ENDPOINT = 'https://api.bilibili.com/x/web-interface/history/cursor';
const HISTORY_REPORT_ENDPOINT = 'https://api.bilibili.com/x/v2/history/report';
const HEARTBEAT_ENDPOINT = 'https://api.bilibili.com/x/click-interface/web/heartbeat';

/** UGC content keys stay as bare bvids so existing cache keys never change. */
const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
/** PGC content keys are `pgc:<epid>`; the number is bounded to a safe integer. */
const PGC_CONTENT_KEY_PATTERN = /^pgc:(\d{1,20})$/i;

export const BILI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': BILI_UA,
  Referer: 'https://www.bilibili.com/',
  Origin: 'https://www.bilibili.com',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

/**
 * Parse the canonical playback identity shared by the host and the panel.
 *
 * UGC keeps its bare bvid, so the existing `${sessionKey}:${bvid}:...` play
 * cache keys stay byte-for-byte identical. PGC uses `pgc:<epid>` so one
 * `contentKey` parameter can carry either kind through `/api/play`.
 *
 * Only these two shapes are accepted; callers must not interpolate an
 * unvalidated content key into an upstream URL.
 *
 * @param {unknown} value
 * @returns {{ kind: 'ugc', bvid: string, contentKey: string }
 *   | { kind: 'pgc', epid: number, contentKey: string } | null}
 */
export function parseContentKey(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;

  const pgc = PGC_CONTENT_KEY_PATTERN.exec(text);
  if (pgc) {
    const epid = Number(pgc[1]);
    if (!Number.isSafeInteger(epid) || epid <= 0) return null;
    return { kind: 'pgc', epid, contentKey: `pgc:${epid}` };
  }

  if (BVID_PATTERN.test(text)) {
    return { kind: 'ugc', bvid: text, contentKey: text };
  }

  return null;
}

/**
 * Fetch the public recommendation feed.
 *
 * `freshIndex` advances the recommendation cursor: Bilibili returns the same
 * batch for the same index, so the caller increments it for every refresh.
 *
 * @param {{ size?: number, timeoutMs?: number, freshIndex?: number, cookies?: Record<string, string> }} [options]
 * @returns {Promise<Array<{ bvid: string, cid: number, title: string, cover: string, owner: { name: string }, url: string, duration: number }>>}
 */
export async function fetchRecommendations({
  size = 12,
  timeoutMs = 9000,
  freshIndex = 1,
  cookies,
} = {}) {
  const url = new URL(FEED_ENDPOINT);
  url.searchParams.set('ps', String(clamp(size, 1, 20)));
  url.searchParams.set('fresh_type', '3');
  url.searchParams.set('feed_version', 'V8');
  url.searchParams.set('plat', '1');
  const cursor = String(clamp(freshIndex, 1, 1_000_000));
  url.searchParams.set('fresh_idx', cursor);
  url.searchParams.set('fresh_idx_1h', cursor);

  const data = await getJson(url, timeoutMs, cookies);
  const items = Array.isArray(data?.item) ? data.item : [];
  return items.map(toCard).filter(Boolean);
}

/**
 * Fetch the latest watch history. Requires the local login cookies; the route
 * rejects anonymous callers before reaching this helper.
 *
 * The cursor endpoint is requested without `business=archive`, so it returns a
 * mixed archive/PGC feed in chronological order. Unknown types (live, article,
 * cheese, …) are dropped instead of being mistaken for ordinary videos.
 *
 * @param {{ size?: number, timeoutMs?: number, cookies?: Record<string, string> }} [options]
 * @returns {Promise<{ items: Array<object>, cursor: { max: number, viewAt: number } | null }>}
 */
export async function fetchHistory({ size = 30, timeoutMs = 10_000, cookies } = {}) {
  const url = new URL(HISTORY_ENDPOINT);
  url.searchParams.set('ps', String(clamp(size, 1, 30)));
  url.searchParams.set('max', '0');
  url.searchParams.set('view_at', '0');

  const data = await getJson(url, timeoutMs, cookies);
  const list = Array.isArray(data?.list) ? data.list : [];
  const cursor =
    data?.cursor && typeof data.cursor === 'object'
      ? {
          max: Number(data.cursor.max) || 0,
          viewAt: Number(data.cursor.view_at) || 0,
        }
      : null;

  return {
    items: list.map(toHistoryItem).filter(Boolean),
    cursor,
  };
}

/**
 * Report watch progress to Bilibili so the account history is created/updated.
 * Both calls are authenticated with the stored cookie and bili_jct CSRF token.
 *
 * The dedicated history endpoint is tried first; the web heartbeat is a
 * fallback because Bilibili occasionally retires one endpoint before another.
 *
 * @param {{
 *   cookies: Record<string, string>, aid: number, bvid: string, cid: number,
 *   progress: number, startTs?: number, realPlayedTime?: number,
 *   event?: 'start'|'heartbeat'|'pause'|'end'|'close',
 * }} options
 */
export async function reportVideoHistory({
  cookies,
  aid,
  bvid,
  cid,
  progress,
  startTs = 0,
  realPlayedTime = 0,
  event = 'heartbeat',
} = {}) {
  const aidNumber = Number(aid);
  const cidNumber = Number(cid);
  if (!Number.isSafeInteger(aidNumber) || aidNumber <= 0) {
    throw new Error('invalid aid');
  }
  if (!Number.isSafeInteger(cidNumber) || cidNumber <= 0) {
    throw new Error('invalid cid');
  }

  const cookie = cookies || {};
  const csrf = typeof cookie.bili_jct === 'string' ? cookie.bili_jct : '';
  if (!cookie.SESSDATA || !csrf) {
    throw new Error('login cookie is missing SESSDATA/bili_jct');
  }
  if (!/^BV[0-9A-Za-z]{10}$/.test(String(bvid || ''))) {
    throw new Error('invalid bvid');
  }

  const played = clamp(progress, 0, 86_400);
  const real = clamp(realPlayedTime || played, 0, 86_400);
  const started = clamp(startTs, 0, 4_000_000_000) ||
    Math.floor(Date.now() / 1000) - played;
  const playType = event === 'start' ? 1 : event === 'pause' ? 2 : 0;

  try {
    await postForm(
      HISTORY_REPORT_ENDPOINT,
      {
        aid: String(aidNumber),
        cid: String(cidNumber),
        progress: String(played),
        csrf,
      },
      8000,
      cookie,
    );
    return { via: 'history-report' };
  } catch (primaryError) {
    // Fall through to the web heartbeat; it accepts bvid and records history too.
    try {
      await postForm(
        HEARTBEAT_ENDPOINT,
        {
          aid: String(aidNumber),
          bvid,
          cid: String(cidNumber),
          mid: String(Number(cookie.DedeUserID) || 0),
          played_time: String(played),
          realtime: String(real),
          start_ts: String(started),
          type: '3',
          dt: '2',
          play_type: String(playType),
          csrf,
        },
        8000,
        cookie,
      );
      return { via: 'heartbeat' };
    } catch (secondaryError) {
      throw new Error(
        `history-report failed: ${primaryError.message}; heartbeat failed: ${secondaryError.message}`,
      );
    }
  }
}

/**
 * Report PGC progress through the web heartbeat.
 *
 * `/x/v2/history/report` does not understand `epid`, so PGC deliberately has
 * its own path and never falls back to the UGC report endpoint. The heartbeat
 * identifies a TV episode with `epid`, the season id (`sid`), `cid` and
 * `type=4`. `seasonId` is named separately here to avoid colliding with the
 * session cookie's `sid`.
 *
 * @param {{
 *   cookies: Record<string, string>, epid: number, seasonId: number,
 *   cid: number, aid?: number, progress: number, startTs?: number,
 *   realPlayedTime?: number,
 *   event?: 'start'|'heartbeat'|'pause'|'end'|'close',
 * }} options
 */
export async function reportPgcHistory({
  cookies,
  epid,
  seasonId,
  cid,
  aid = 0,
  progress,
  startTs = 0,
  realPlayedTime = 0,
  event = 'heartbeat',
} = {}) {
  const epId = normalizeEpid(epid);
  const cidNumber = Number(cid);
  const seasonNumber = Number(seasonId);
  if (!epId) throw new Error('invalid epid');
  if (!Number.isSafeInteger(seasonNumber) || seasonNumber <= 0) {
    throw new Error('invalid season id');
  }
  if (!Number.isSafeInteger(cidNumber) || cidNumber <= 0) {
    throw new Error('invalid cid');
  }

  const cookie = cookies || {};
  const csrf = typeof cookie.bili_jct === 'string' ? cookie.bili_jct : '';
  if (!cookie.SESSDATA || !csrf) {
    throw new Error('login cookie is missing SESSDATA/bili_jct');
  }

  const played = clamp(progress, 0, 86_400);
  const real = clamp(realPlayedTime || played, 0, 86_400);
  const started = clamp(startTs, 0, 4_000_000_000) ||
    Math.floor(Date.now() / 1000) - played;
  const playType = event === 'start' ? 1 : event === 'pause' ? 2 : 0;

  const form = {
    epid: String(epId),
    sid: String(seasonNumber),
    cid: String(cidNumber),
    mid: String(Number(cookie.DedeUserID) || 0),
    played_time: String(played),
    realtime: String(real),
    start_ts: String(started),
    type: '4',
    dt: '2',
    play_type: String(playType),
    csrf,
  };

  // The web player sends the episode's aid when it has one; it is not required
  // for the PGC heartbeat, so omit it rather than sending a bogus 0.
  const aidNumber = Number(aid);
  if (Number.isSafeInteger(aidNumber) && aidNumber > 0) {
    form.aid = String(aidNumber);
  }

  await postForm(HEARTBEAT_ENDPOINT, form, 8000, cookie);
  return { via: 'pgc-heartbeat' };
}

/**
 * Fetch a video's metadata and pages.
 *
 * @param {string} bvid
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{
 *   aid: number, bvid: string, cid: number, title: string, cover: string, duration: number,
 *   owner: { name: string },
 *   pages: Array<{ cid: number, page: number, part: string, duration: number }>,
 * }>}
 */
export async function fetchVideoView(bvid, { timeoutMs = 9000 } = {}) {
  const url = new URL(VIEW_ENDPOINT);
  url.searchParams.set('bvid', bvid);

  const data = await getJson(url, timeoutMs);
  if (!data || typeof data !== 'object') {
    throw new Error('B 站没有返回视频信息');
  }

  const pages = Array.isArray(data.pages)
    ? data.pages
        .map((page) => ({
          cid: Number(page?.cid) || 0,
          page: Number(page?.page) || 0,
          part: stripTags(page?.part),
          duration: Number(page?.duration) || 0,
        }))
        .filter((page) => page.cid > 0)
    : [];

  return {
    aid: Number(data.aid) || 0,
    bvid: String(data.bvid ?? bvid),
    cid: Number(data.cid) || 0,
    title: stripTags(data.title),
    cover: toHttps(data.pic),
    duration: Number(data.duration) || 0,
    owner: { name: stripTags(data.owner?.name) },
    pages,
  };
}

/**
 * Resolve a PGC episode and its season from `/pgc/view/web/season?ep_id=`.
 *
 * PGC season payloads live under `result` and their episode `duration` is in
 * milliseconds (unlike the UGC view endpoint, which uses seconds). The
 * returned `episode` is the authoritative source for `cid`, `aid` and the
 * season id used by the heartbeat report.
 *
 * @param {number|string} epid
 * @param {{ timeoutMs?: number, cookies?: Record<string, string> }} [options]
 * @returns {Promise<{
 *   seasonId: number, title: string, cover: string,
 *   owner: { name: string },
 *   episodes: Array<{
 *     epid: number, aid: number, bvid: string, cid: number, seasonId: number,
 *     title: string, longTitle: string, showTitle: string,
 *     cover: string, duration: number, pubTime: number,
 *   }>,
 *   episode: object,
 * }>}
 */
export async function fetchPgcSeason(
  epid,
  { timeoutMs = 9000, cookies } = {},
) {
  const epId = normalizeEpid(epid);
  if (!epId) throw new Error('invalid epid');

  const url = new URL(PGC_SEASON_ENDPOINT);
  url.searchParams.set('ep_id', String(epId));

  const data = await getPgcJson(url, timeoutMs, cookies);
  if (!data || typeof data !== 'object') {
    throw new Error('B 站没有返回番剧信息');
  }

  const episodes = Array.isArray(data.episodes)
    ? data.episodes.map(toPgcEpisode).filter(Boolean)
    : [];
  if (episodes.length === 0) {
    throw new Error('B 站没有返回番剧剧集');
  }

  const episode = episodes.find((entry) => entry.epid === epId) || null;
  if (!episode) {
    throw new Error('没有找到该番剧剧集');
  }

  const seasonId =
    Number(data.season_id) ||
    Number(data.season?.season_id) ||
    episode.seasonId ||
    0;

  return {
    seasonId,
    title: stripTags(data.title),
    cover: toHttps(data.cover || data.bkg_cover || ''),
    owner: {
      name: stripTags(
        data.up_info?.uname || data.season?.up_info?.uname || '',
      ),
    },
    episodes,
    // The season endpoint only puts season_id at the top level; make the
    // selected episode self-contained for the heartbeat reporter.
    episode: { ...episode, seasonId },
  };
}

/**
 * Fetch DASH tracks (`fnval=16`). The web player needs separate video and audio
 * representations for 1080P; the old `durl` MP4 endpoint caps at 720P.
 *
 * Logged-in requests pass the local cookies so Bilibili can return 1080P.
 *
 * @param {string} bvid
 * @param {number} cid
 * @param {{ qn?: number, cookies?: Record<string, string>, timeoutMs?: number }} [options]
 * @returns {Promise<{
 *   quality: number, format: string,
 *   acceptQuality: number[], acceptDescription: string[],
 *   dash: {
 *     duration: number, minBufferTime: number,
 *     video: Array<object>, audio: Array<object>,
 *   } | null,
 * }>}
 */
export async function fetchPlayUrl(
  bvid,
  cid,
  { qn = 64, cookies, timeoutMs = 9000 } = {},
) {
  const url = new URL(PLAYURL_ENDPOINT);
  url.searchParams.set('bvid', bvid);
  url.searchParams.set('cid', String(cid));
  url.searchParams.set('qn', String(clamp(qn, 16, 120)));
  url.searchParams.set('fnver', '0');
  url.searchParams.set('fnval', '16');
  url.searchParams.set('fourk', '1');

  const data = await getJson(url, timeoutMs, cookies);
  return {
    quality: Number(data?.quality) || 0,
    format: String(data?.format ?? ''),
    acceptQuality: Array.isArray(data?.accept_quality)
      ? data.accept_quality.map(Number)
      : [],
    acceptDescription: Array.isArray(data?.accept_description)
      ? data.accept_description.map(String)
      : [],
    dash: normalizeDash(data?.dash),
  };
}

/**
 * Fetch the legacy progressive MP4 stream (`fnval=1`). Used for the anonymous
 * 720P path: Bilibili's DASH endpoint downgrades anonymous playback to 480P,
 * while the MP4 endpoint still serves 720P. Logged-in playback uses DASH.
 *
 * @param {string} bvid
 * @param {number} cid
 * @param {{ qn?: number, cookies?: Record<string, string>, timeoutMs?: number }} [options]
 */
export async function fetchMp4PlayUrl(
  bvid,
  cid,
  { qn = 64, cookies, timeoutMs = 9000 } = {},
) {
  const url = new URL(PLAYURL_ENDPOINT);
  url.searchParams.set('bvid', bvid);
  url.searchParams.set('cid', String(cid));
  url.searchParams.set('qn', String(clamp(qn, 16, 120)));
  url.searchParams.set('fnver', '0');
  url.searchParams.set('fnval', '1');
  url.searchParams.set('fourk', '1');

  const data = await getJson(url, timeoutMs, cookies);
  const segments = Array.isArray(data?.durl)
    ? data.durl
        .map((segment) => ({
          order: Number(segment?.order) || 0,
          durationMs: Number(segment?.length) || 0,
          size: Number(segment?.size) || 0,
          url: toHttps(segment?.url),
        }))
        .filter((segment) => segment.url)
        .sort((a, b) => a.order - b.order)
    : [];

  return {
    quality: Number(data?.quality) || 0,
    format: String(data?.format ?? ''),
    acceptQuality: Array.isArray(data?.accept_quality)
      ? data.accept_quality.map(Number)
      : [],
    acceptDescription: Array.isArray(data?.accept_description)
      ? data.accept_description.map(String)
      : [],
    segments,
  };
}

/**
 * Fetch a PGC episode's play URL. Unlike UGC, PGC is DASH-only in this plugin:
 * the anonymous endpoint still returns a `dash` object (usually 480P), so there
 * is no progressive-MP4 fallback here yet.
 *
 * The payload is under `result`, not `data`; `normalizeDash()` is shared with
 * the UGC path because the track shape is the same.
 *
 * @param {number|string} epid
 * @param {number} cid
 * @param {{ qn?: number, cookies?: Record<string, string>, timeoutMs?: number }} [options]
 * @returns {Promise<{
 *   quality: number, format: string, duration: number,
 *   acceptQuality: number[], acceptDescription: string[],
 *   dash: {
 *     duration: number, minBufferTime: number,
 *     video: Array<object>, audio: Array<object>,
 *   } | null,
 * }>}
 */
export async function fetchPgcPlayUrl(
  epid,
  cid,
  { qn = 64, cookies, timeoutMs = 9000 } = {},
) {
  const epId = normalizeEpid(epid);
  if (!epId) throw new Error('invalid epid');
  const cidNumber = Number(cid);
  if (!Number.isSafeInteger(cidNumber) || cidNumber <= 0) {
    throw new Error('invalid cid');
  }

  const url = new URL(PGC_PLAYURL_ENDPOINT);
  url.searchParams.set('ep_id', String(epId));
  url.searchParams.set('cid', String(cidNumber));
  url.searchParams.set('qn', String(clamp(qn, 16, 120)));
  url.searchParams.set('fnver', '0');
  url.searchParams.set('fnval', '16');
  url.searchParams.set('fourk', '1');

  const data = await getPgcJson(url, timeoutMs, cookies);
  if (!data || typeof data !== 'object') {
    throw new Error('B 站没有返回番剧播放地址');
  }

  return {
    quality: Number(data.quality) || 0,
    format: String(data.format ?? ''),
    duration:
      Number(data.dash?.duration) ||
      Math.round((Number(data.timelength) || 0) / 1000) ||
      0,
    acceptQuality: Array.isArray(data.accept_quality)
      ? data.accept_quality.map(Number)
      : [],
    acceptDescription: Array.isArray(data.accept_description)
      ? data.accept_description.map(String)
      : [],
    dash: normalizeDash(data.dash),
  };
}

/** Normalize Bilibili's DASH video/audio tracks into flat MPD-friendly rows. */
function normalizeDash(dash) {
  if (!dash || typeof dash !== 'object') return null;
  const video = Array.isArray(dash.video)
    ? dash.video.map((track) => normalizeDashTrack(track, 'video')).filter(Boolean)
    : [];
  const audio = Array.isArray(dash.audio)
    ? dash.audio.map((track) => normalizeDashTrack(track, 'audio')).filter(Boolean)
    : [];
  if (video.length === 0 || audio.length === 0) return null;
  return {
    duration: Number(dash.duration) || 0,
    minBufferTime: Number(dash.minBufferTime || dash.min_buffer_time) || 1.5,
    video,
    audio,
  };
}

function normalizeDashTrack(track, kind) {
  if (!track || typeof track !== 'object') return null;
  const baseUrl = toHttps(track.baseUrl || track.base_url);
  if (!baseUrl) return null;
  const segmentBase = track.SegmentBase || track.segment_base || {};
  return {
    kind,
    id: Number(track.id) || 0,
    baseUrl,
    bandwidth: Number(track.bandwidth) || 0,
    mimeType: String(track.mimeType || track.mime_type || ''),
    codecs: String(track.codecs || ''),
    width: Number(track.width) || 0,
    height: Number(track.height) || 0,
    frameRate: String(track.frameRate || track.frame_rate || ''),
    sar: String(track.sar || ''),
    codecid: Number(track.codecid) || 0,
    initRange: String(segmentBase.Initialization || segmentBase.initialization || ''),
    indexRange: String(segmentBase.indexRange || segmentBase.index_range || ''),
  };
}

/** Shared JSON request with Bilibili's browser-like headers and error mapping. */
async function getJson(url, timeoutMs = 9000, cookies) {
  const cookie = cookieHeader(cookies);
  const headers = cookie ? { ...HEADERS, Cookie: cookie } : HEADERS;
  let response;
  try {
    response = await fetch(url, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(clamp(timeoutMs, 1000, 30000)),
    });
  } catch (error) {
    throw new Error(`无法连接 B 站接口：${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`B 站接口返回 HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.code !== 0) {
    throw new Error(
      `B 站接口错误 ${payload?.code ?? '?'}：${payload?.message ?? 'unknown'}`,
    );
  }

  return payload.data;
}

/**
 * JSON request for the PGC API family, whose payload lives under `result`
 * rather than `data`. Kept separate from getJson() on purpose: the UGC request
 * path must not change while PGC support is being added.
 */
async function getPgcJson(url, timeoutMs = 9000, cookies) {
  const cookie = cookieHeader(cookies);
  const headers = cookie ? { ...HEADERS, Cookie: cookie } : HEADERS;
  let response;
  try {
    response = await fetch(url, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(clamp(timeoutMs, 1000, 30000)),
    });
  } catch (error) {
    throw new Error(`无法连接 B 站接口：${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`B 站接口返回 HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.code !== 0) {
    throw new Error(
      `B 站接口错误 ${payload?.code ?? '?'}：${payload?.message ?? 'unknown'}`,
    );
  }

  return payload.result ?? payload.data;
}

/** POST a form to a fixed Bilibili endpoint; the caller controls cookies. */
async function postForm(url, form, timeoutMs = 8000, cookies) {
  const cookie = cookieHeader(cookies);
  const headers = {
    ...HEADERS,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (cookie) headers.Cookie = cookie;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: new URLSearchParams(form),
      redirect: 'error',
      signal: AbortSignal.timeout(clamp(timeoutMs, 1000, 30000)),
    });
  } catch (error) {
    throw new Error(`无法连接 B 站接口：${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`B 站接口返回 HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.code !== 0) {
    throw new Error(
      `B 站接口错误 ${payload?.code ?? '?'}：${payload?.message ?? 'unknown'}`,
    );
  }
  return payload.data;
}

/** Serialize cookies for the feed request; never log the result. */
function cookieHeader(cookies) {
  if (!cookies || typeof cookies !== 'object') return '';
  return Object.entries(cookies)
    .filter(
      ([name, value]) =>
        typeof name === 'string' &&
        typeof value === 'string' &&
        value.length > 0 &&
        value.length < 4096 &&
        !/[\r\n;]/.test(value),
    )
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/**
 * Route a mixed history row to the UGC or PGC normalizer.
 *
 * Only ordinary archive and PGC rows are surfaced. Live/article/cheese rows
 * have their own shapes and must not fall through to the BV-only UGC mapper.
 * A missing business field is treated as legacy archive so older responses
 * keep working.
 */
function toHistoryItem(item) {
  const business = String(
    item?.history?.business || item?.business || '',
  ).trim().toLowerCase();
  if (business === 'pgc') return toPgcHistoryCard(item);
  if (business && business !== 'archive') return null;
  return toHistoryCard(item);
}

/** Normalize a history row; the API mixes bvid/history.bvid and may use an array cover. */
function toHistoryCard(item) {
  const bvid = typeof item?.bvid === 'string'
    ? item.bvid.trim()
    : typeof item?.history?.bvid === 'string'
      ? item.history.bvid.trim()
      : '';
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return null;

  const title = stripTags(item?.title);
  if (!title) return null;

  const coverValue = Array.isArray(item?.cover) ? item.cover[0] : item?.cover;
  const cover = typeof coverValue === 'string' ? toHttps(coverValue) : '';
  const cid = Number(item?.history?.cid) || Number(item?.cid) || 0;

  return {
    kind: 'ugc',
    contentKey: bvid,
    bvid,
    cid,
    title,
    cover,
    owner: {
      name: stripTags(
        item?.author_name || item?.owner?.name || item?.author?.name || '',
      ),
    },
    url: `https://www.bilibili.com/video/${bvid}`,
    duration: Number(item?.duration) || 0,
    progress: Number(item?.progress) || 0,
    viewAt: Number(item?.view_at) || 0,
  };
}

/**
 * Normalize a PGC history row.
 *
 * PGC history rows are identified by `history.business === 'pgc'` and
 * `history.epid`; `item.kid` is the season id. They usually have no usable
 * bvid, so they must be mapped before the BV-only toHistoryCard(). fetchHistory()
 * dispatches through toHistoryItem() on history.business.
 */
function toPgcHistoryCard(item) {
  const history = item?.history;
  const business = String(
    history?.business || item?.business || '',
  ).trim().toLowerCase();
  if (business !== 'pgc') return null;

  const epid = normalizeEpid(history?.epid ?? item?.epid);
  const cid = Number(history?.cid) || Number(item?.cid) || 0;
  if (
    !epid ||
    !Number.isSafeInteger(cid) ||
    cid <= 0
  ) {
    return null;
  }

  const seasonTitle = stripTags(item?.title);
  const episodeTitle =
    stripTags(item?.long_title) || stripTags(item?.show_title);
  const title = [seasonTitle, episodeTitle].filter(Boolean).join(' · ');
  if (!title) return null;

  const coverValue = Array.isArray(item?.cover) ? item.cover[0] : item?.cover;
  const cover = typeof coverValue === 'string' ? toHttps(coverValue) : '';
  const seasonId =
    Number(item?.kid) ||
    Number(item?.season_id) ||
    Number(history?.season_id) ||
    0;

  return {
    kind: 'pgc',
    contentKey: `pgc:${epid}`,
    epid,
    seasonId,
    cid,
    title,
    seasonTitle,
    episodeTitle,
    cover,
    owner: {
      name: stripTags(item?.author_name || item?.owner?.name || ''),
    },
    url: `https://www.bilibili.com/bangumi/play/ep${epid}`,
    duration: Number(item?.duration) || 0,
    progress: Number(item?.progress) || 0,
    viewAt: Number(item?.view_at) || 0,
  };
}

/** Normalize one feed item; return null for ads or malformed rows. */
function toCard(item) {
  if (item?.goto === 'ad') return null;

  const bvid = typeof item?.bvid === 'string' ? item.bvid.trim() : '';
  const title = stripTags(item?.title);
  if (!bvid || !title) return null;

  return {
    kind: 'ugc',
    contentKey: bvid,
    bvid,
    cid: Number(item?.cid) || 0,
    title,
    cover: toHttps(item?.pic || item?.pic_4_3 || ''),
    owner: { name: stripTags(item?.owner?.name) },
    url: `https://www.bilibili.com/video/${bvid}`,
    duration: Number(item?.duration) || 0,
  };
}

/** Normalize one `result.episodes[]` row from the PGC season endpoint. */
function toPgcEpisode(value) {
  if (!value || typeof value !== 'object') return null;

  const epid = normalizeEpid(value.ep_id ?? value.id);
  const cid = Number(value.cid) || 0;
  if (!epid || !Number.isSafeInteger(cid) || cid <= 0) return null;

  const longTitle = stripTags(value.long_title);
  const showTitle = stripTags(value.show_title);
  const bvid = String(value.bvid ?? '').trim();

  return {
    epid,
    aid: Number(value.aid) || 0,
    bvid: BVID_PATTERN.test(bvid) ? bvid : '',
    cid,
    seasonId: Number(value.season_id) || 0,
    title: showTitle || longTitle || stripTags(value.title),
    longTitle,
    showTitle,
    cover: toHttps(value.cover || ''),
    // The season endpoint reports milliseconds; the panel and the heartbeat
    // both use seconds.
    duration: msToSeconds(value.duration),
    pubTime: Number(value.pub_time) || 0,
  };
}

function msToSeconds(value) {
  const n = Number(value) || 0;
  return n > 0 ? Math.max(1, Math.round(n / 1000)) : 0;
}

function normalizeEpid(value) {
  const text =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : '';
  if (!/^\d{1,20}$/.test(text)) return 0;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function stripTags(value) {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : '';
}

function toHttps(value) {
  if (typeof value !== 'string' || !value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  return value.replace(/^http:\/\//, 'https://');
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(Math.trunc(n), min), max);
}
