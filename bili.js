/**
 * Bilibili API helpers.
 *
 * The recommendation feed returns `data.item[]` with `pic` as its cover field.
 * It is anonymous by default; when the caller passes the local login cookies,
 * the same endpoint returns the personalized feed. The play flow uses the
 * public view endpoint for `cid`, DASH (`fnval=16`) for logged-in 720P/1080P,
 * and progressive MP4 (`fnval=1`) as the anonymous 720P fallback.
 */

const FEED_ENDPOINT = 'https://api.bilibili.com/x/web-interface/index/top/feed/rcmd';
const VIEW_ENDPOINT = 'https://api.bilibili.com/x/web-interface/view';
const PLAYURL_ENDPOINT = 'https://api.bilibili.com/x/player/playurl';
const HISTORY_ENDPOINT = 'https://api.bilibili.com/x/web-interface/history/cursor';
const HISTORY_REPORT_ENDPOINT = 'https://api.bilibili.com/x/v2/history/report';
const HEARTBEAT_ENDPOINT = 'https://api.bilibili.com/x/click-interface/web/heartbeat';

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
 * @param {{ size?: number, timeoutMs?: number, cookies?: Record<string, string> }} [options]
 * @returns {Promise<{ items: Array<object>, cursor: { max: number, viewAt: number } | null }>}
 */
export async function fetchHistory({ size = 30, timeoutMs = 10_000, cookies } = {}) {
  const url = new URL(HISTORY_ENDPOINT);
  url.searchParams.set('ps', String(clamp(size, 1, 30)));
  url.searchParams.set('max', '0');
  url.searchParams.set('view_at', '0');
  url.searchParams.set('business', 'archive');

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
    items: list.map(toHistoryCard).filter(Boolean),
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

/** Normalize one feed item; return null for ads or malformed rows. */
function toCard(item) {
  if (item?.goto === 'ad') return null;

  const bvid = typeof item?.bvid === 'string' ? item.bvid.trim() : '';
  const title = stripTags(item?.title);
  if (!bvid || !title) return null;

  return {
    bvid,
    cid: Number(item?.cid) || 0,
    title,
    cover: toHttps(item?.pic || item?.pic_4_3 || ''),
    owner: { name: stripTags(item?.owner?.name) },
    url: `https://www.bilibili.com/video/${bvid}`,
    duration: Number(item?.duration) || 0,
  };
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
