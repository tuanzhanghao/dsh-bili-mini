/**
 * Browser-trust fence for the plugin's `/bili-mini` routes.
 *
 * This is a compact adaptation of `isTrustedRequest` from
 * `@tivility/dsh-web-kit` v1.1.0 (MIT,
 * https://github.com/Tivility/dsh-plugins), which is itself a port of the DSH
 * harness's `isTrustedApiRequest`. The harness applies that fence to its own
 * `/api` routes, but **not** to routes registered through `webServer`, so a
 * plugin route must apply it itself.
 *
 * This is not authentication. It answers "does this request look like it came
 * from a page served by this loopback server?", never "who is asking". Access
 * control still belongs to the plugin's login/session checks.
 *
 * Three fences for API routes:
 *   1. Host must be a loopback authority (DNS-rebinding defense).
 *   2. An explicit `Sec-Fetch-Site: cross-site` is refused.
 *   3. An Origin, when present, must be the loopback authority (localhost and
 *      127.0.0.1 with the same port are treated as equivalent). When Origin is
 *      absent, an HTTP(S) Referer is checked the same way. Absent browser
 *      markers are allowed, matching the harness's Origin-only fence.
 *
 * Capability/static routes (`/stream/`, `/dash/`, `/vendor/`) use fence 1 only
 * through `isTrustedLoopbackRequest`, because <video> and <script> loads do not
 * reliably carry the same Origin/Fetch-Metadata as same-origin fetch() calls.
 */

/**
 * Read a single-valued header from a Node `IncomingMessage`.
 * @param {import('node:http').IncomingMessage} req
 * @param {string} name
 * @returns {string | undefined}
 */
function header(req, name) {
  const value = req?.headers?.[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Parse a bare `host[:port]` authority. Reject shapes WHATWG would silently
 * reinterpret (paths, credentials, whitespace) instead of trusting them.
 * @param {string} authority
 * @returns {URL | null}
 */
function parseAuthority(authority) {
  if (
    typeof authority !== 'string' ||
    authority.length === 0 ||
    authority.trim() !== authority ||
    /[/?#@\\]/.test(authority)
  ) {
    return null;
  }
  try {
    return new URL(`http://${authority}`);
  } catch {
    return null;
  }
}

/**
 * Whether a normalized URL hostname is loopback.
 * IPv6 literals keep their brackets in WHATWG URLs.
 * @param {string} hostname
 * @returns {boolean}
 */
export function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  const parts = hostname.split('.');
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

/**
 * Compare an Origin/Referer URL against the request Host authority.
 *
 * Exact authority wins. `localhost` ↔ `127.0.0.1` (and IPv6 loopback) are
 * treated as equivalent only when the port also matches, which keeps the
 * plugin working when the desktop shell normalizes `localhost` to
 * `127.0.0.1` for media URLs.
 * @param {string} value
 * @param {URL} hostUrl
 * @returns {boolean}
 */
function isTrustedOrigin(value, hostUrl) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  if (url.host === hostUrl.host) return true;
  return (
    isLoopbackHostname(url.hostname) &&
    isLoopbackHostname(hostUrl.hostname) &&
    url.port === hostUrl.port
  );
}

/**
 * Parse the request's `Host` and require a loopback authority.
 * @param {import('node:http').IncomingMessage} req
 * @returns {URL | null}
 */
function trustedHostUrl(req) {
  const host = header(req, 'host');
  if (host === undefined) return null;

  const hostUrl = parseAuthority(host);
  if (!hostUrl || !isLoopbackHostname(hostUrl.hostname)) return null;
  return hostUrl;
}

/**
 * Host-only fence for capability URLs (`/stream/<token>`, `/dash/<token>`) and
 * public vendored scripts.
 *
 * These routes deliberately skip Origin / Sec-Fetch-Site: browsers load media
 * and `<script>` resources with different Fetch Metadata than same-origin
 * `fetch()` API calls, and a false 403 there breaks playback. The URL token is
 * the authorization for media; the vendored scripts are public, immutable
 * player assets. DNS-rebinding protection still applies through `Host`.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function isTrustedLoopbackRequest(req) {
  return trustedHostUrl(req) !== null;
}

/**
 * Decide whether a request may reach the plugin's API routes.
 *
 * Mount this at the very top of the `webServer.register` handler for normal
 * routes. Capability/static routes may use `isTrustedLoopbackRequest` instead;
 * see the route dispatch in index.js.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function isTrustedRequest(req) {
  const hostUrl = trustedHostUrl(req);
  if (!hostUrl) return false;

  const site = header(req, 'sec-fetch-site');
  if (site !== undefined && site.toLowerCase() === 'cross-site') {
    return false;
  }

  // Origin is authoritative when a browser attaches it. `Origin: null`
  // (sandboxed iframes, file: pages) is opaque and therefore refused.
  const origin = header(req, 'origin');
  if (origin !== undefined) {
    return isTrustedOrigin(origin, hostUrl);
  }

  // Referer is only a fallback. An HTTP(S) Referer must match; a non-HTTP
  // scheme (the desktop shell may use a custom scheme) cannot be compared to
  // an HTTP Host, so it falls through to the Host fence just like the
  // harness's Origin-only check.
  const referer = header(req, 'referer');
  if (referer !== undefined) {
    let url;
    try {
      url = new URL(referer);
    } catch {
      return false;
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return isTrustedOrigin(referer, hostUrl);
    }
  }

  // A browser GET can legitimately carry neither Origin nor Referer. The Host
  // fence above is what blocks DNS rebinding; absent markers are not a
  // downgrade in the harness's threat model.
  return true;
}
