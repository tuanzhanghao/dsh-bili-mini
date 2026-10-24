/**
 * Bilibili QR login + local session storage.
 *
 * Security boundaries:
 *   - the browser never receives SESSDATA/bili_jct; only the backend reads them
 *   - cookies are only sent to *.bilibili.com, and redirects are refused
 *   - the QR login URL returned on success (`data.url`) is parsed, never fetched
 *   - every log/error goes through redact()
 *   - data/cookie.json is written atomically; POSIX mode 0600, Windows ACL
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const qrcode = require('./vendor/qrcode-generator.cjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, 'data');
const COOKIE_FILE = path.join(DATA_DIR, 'cookie.json');
const IS_WINDOWS = process.platform === 'win32';

/** POSIX mode bits are meaningless on Windows; let the user-profile ACL apply. */
function restrictPermissions(target, mode) {
  if (IS_WINDOWS) return;
  try {
    fs.chmodSync(target, mode);
  } catch {
    // Non-POSIX filesystems (FAT/exFAT/network shares) may reject chmod.
  }
}

/**
 * Windows can briefly lock a destination file (antivirus/indexer), making
 * rename fail. A copy is non-atomic but preserves the old file if it fails.
 */
function replaceFile(tmp, target) {
  try {
    fs.renameSync(tmp, target);
  } catch (error) {
    if (
      IS_WINDOWS &&
      (error.code === 'EPERM' ||
        error.code === 'EACCES' ||
        error.code === 'EEXIST')
    ) {
      fs.copyFileSync(tmp, target);
      return;
    }
    throw error;
  }
}

const QR_GENERATE =
  'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const QR_POLL =
  'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';
const NAV = 'https://api.bilibili.com/x/web-interface/nav';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE_HEADERS = {
  'User-Agent': UA,
  Referer: 'https://www.bilibili.com/',
  Origin: 'https://www.bilibili.com',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

const AUTH_COOKIES = new Set([
  'SESSDATA',
  'bili_jct',
  'DedeUserID',
  'DedeUserID__ckMd5',
  'sid',
  'buvid3',
  'buvid4',
]);

const SENSITIVE_RE =
  /"?\b(SESSDATA|bili_jct|DedeUserID__ckMd5|DedeUserID|sid|buvid3|buvid4|qrcode_key)\b"?\s*[=:]\s*"?([^;,\s&"'}\]]+)/gi;

/** Mask auth cookies and login keys before anything reaches a log or the UI. */
export function redact(value) {
  return String(value ?? '')
    .replace(SENSITIVE_RE, '$1=***')
    .replace(/Cookie:\s*[^\r\n]+/gi, 'Cookie: ***');
}

function assertBiliUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('blocked non-https URL');
  const host = url.hostname.toLowerCase();
  if (host !== 'bilibili.com' && !host.endsWith('.bilibili.com')) {
    throw new Error('blocked non-bilibili host');
  }
  return url;
}

/**
 * The only outbound JSON helper that can carry cookies. It refuses non-Bilibili
 * hosts, refuses redirects, and only attaches cookies when explicitly asked.
 */
async function biliFetch(raw, { cookies, timeoutMs = 10_000 } = {}) {
  const url = assertBiliUrl(raw);
  const headers = { ...BASE_HEADERS };
  if (cookies) {
    const header = cookieHeader(cookies);
    if (header) headers.Cookie = header;
  }
  return fetch(url, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function safeCookieValue(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length < 4096 &&
    !/[\r\n;]/.test(value)
  );
}

function cookieHeader(cookies) {
  return Object.entries(cookies)
    .filter(([name, value]) => AUTH_COOKIES.has(name) && safeCookieValue(value))
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function pickCookies(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [name, value] of Object.entries(input)) {
    if (AUTH_COOKIES.has(name) && safeCookieValue(value)) out[name] = value;
  }
  return out;
}

/** Capture Set-Cookie values from the poll response. */
function setCookieMap(headers) {
  const lines =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers.get('set-cookie')].filter(Boolean);
  const cookies = {};
  for (const line of lines) {
    const first = line.split(';', 1)[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (AUTH_COOKIES.has(name) && safeCookieValue(value)) {
      cookies[name] = value;
    }
  }
  return cookies;
}

/**
 * Parse (never fetch) the success `data.url`. It can live on
 * passport.biligame.com and carry SESSDATA in its query.
 */
function urlCookieMap(value) {
  if (typeof value !== 'string' || !value) return {};
  try {
    const url = new URL(value);
    const cookies = {};
    for (const [name, val] of url.searchParams) {
      if (AUTH_COOKIES.has(name) && safeCookieValue(val)) {
        cookies[name] = val;
      }
    }
    return cookies;
  } catch {
    return {};
  }
}

export function loadSession() {
  try {
    const parsed = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    const cookies = pickCookies(parsed?.cookies);
    if (!cookies.SESSDATA) return null;
    restrictPermissions(COOKIE_FILE, 0o600);
    const user =
      parsed?.user && typeof parsed.user === 'object'
        ? {
            mid: Number(parsed.user.mid) || 0,
            name: typeof parsed.user.name === 'string' ? parsed.user.name : '',
            face: typeof parsed.user.face === 'string' ? parsed.user.face : '',
          }
        : null;
    return { savedAt: Number(parsed.savedAt) || 0, cookies, user };
  } catch {
    return null;
  }
}

export function saveSession(cookies, user) {
  const safe = pickCookies(cookies);
  if (!safe.SESSDATA) throw new Error('扫码成功但没有拿到 SESSDATA');

  const safeUser = user
    ? {
        mid: Number(user.mid) || 0,
        name: String(user.name || ''),
        face: String(user.face || ''),
      }
    : null;

  fs.mkdirSync(DATA_DIR, {
    recursive: true,
    ...(IS_WINDOWS ? {} : { mode: 0o700 }),
  });
  restrictPermissions(DATA_DIR, 0o700);

  const tmp = path.join(
    DATA_DIR,
    `cookie.json.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(
      tmp,
      JSON.stringify(
        { version: 1, savedAt: Date.now(), cookies: safe, user: safeUser },
        null,
        2,
      ),
      IS_WINDOWS ? {} : { mode: 0o600 },
    );
    replaceFile(tmp, COOKIE_FILE);
    restrictPermissions(COOKIE_FILE, 0o600);
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Best effort.
    }
  }
}

/** Delete the cookie file and any interrupted atomic-write temp files. */
export function clearSession() {
  try {
    fs.rmSync(COOKIE_FILE, { force: true });
  } catch {
    // Nothing to remove.
  }
  try {
    for (const name of fs.readdirSync(DATA_DIR)) {
      if (name.startsWith('cookie.json.') && name.endsWith('.tmp')) {
        fs.rmSync(path.join(DATA_DIR, name), { force: true });
      }
    }
  } catch {
    // Data directory may not exist.
  }
}

async function fetchUser(cookies) {
  const response = await biliFetch(NAV, { cookies, timeoutMs: 5000 });
  const payload = await response.json().catch(() => null);
  if (payload?.code === 0 && payload.data?.isLogin) {
    return {
      mid: Number(payload.data.mid) || 0,
      name: String(payload.data.uname || ''),
      face: String(payload.data.face || ''),
    };
  }
  return null;
}

export async function generateQr() {
  const response = await biliFetch(QR_GENERATE);
  if (!response.ok) throw new Error(`二维码接口 HTTP ${response.status}`);

  const payload = await response.json();
  if (payload?.code !== 0) {
    throw new Error(
      `二维码接口错误 ${payload?.code}: ${redact(payload?.message || '')}`,
    );
  }

  const url = String(payload?.data?.url || '');
  const key = String(payload?.data?.qrcode_key || '');
  if (!url || !key) throw new Error('二维码接口没有返回完整数据');

  // Generate locally. The login URL never goes to a third-party QR service.
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });

  return {
    key,
    image: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
    expiresIn: 180,
  };
}

export async function pollQr(key) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(key))) {
    throw new Error('invalid qrcode key');
  }

  const url = new URL(QR_POLL);
  url.searchParams.set('qrcode_key', key);
  url.searchParams.set('source', 'main-fe-header');

  const response = await biliFetch(url.toString());
  if (!response.ok) throw new Error(`扫码状态接口 HTTP ${response.status}`);

  const payload = await response.json();
  if (payload?.code !== 0) {
    throw new Error(
      `扫码状态接口错误 ${payload?.code}: ${redact(payload?.message || '')}`,
    );
  }

  const data = payload?.data || {};
  const statusCode = Number(data.code);

  if (statusCode === 86101) return { status: 'waiting', message: '等待扫码' };
  if (statusCode === 86090) {
    return { status: 'scanned', message: '已扫码，请在手机上确认' };
  }
  if (statusCode === 86038) return { status: 'expired', message: '二维码已过期' };
  if (statusCode !== 0) {
    return {
      status: 'error',
      message: redact(data.message || `未知状态 ${statusCode}`),
    };
  }

  // Success: Set-Cookie is authoritative; the cross-domain URL is a fallback.
  const cookies = {
    ...urlCookieMap(data.url),
    ...setCookieMap(response.headers),
  };
  const safe = pickCookies(cookies);
  if (!safe.SESSDATA) throw new Error('扫码成功但没有拿到 SESSDATA');

  // Persist immediately so a slow/failed nav call cannot lose the login.
  saveSession(safe, null);
  const user = await fetchUser(safe).catch(() => null);
  if (user) {
    try {
      saveSession(safe, user);
    } catch {
      // The cookie file from the first write is still valid.
    }
  }

  return { status: 'success', message: '登录成功', user };
}

export function loginStatus() {
  const session = loadSession();
  return session
    ? { loggedIn: true, user: session.user, savedAt: session.savedAt }
    : { loggedIn: false, user: null };
}

export function logout() {
  clearSession();
  return { loggedIn: false };
}
