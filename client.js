/**
 * Browser half of dsh-bili-mini.
 *
 * Registers the sidebar entry (`sidebar.panellist`) and the page it opens
 * (the layout's keyed `main` slot). Both carry the same id, so selecting the
 * sidebar row finds the panel. The panel fetches `/bili-mini/api/feed` and
 * renders the recommendations as a responsive cover-and-title card grid.
 */
window.__ModuleLoader__.load({
  id: 'dsh-bili-mini',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const PANEL_ID = 'bili-mini';
    const NS = 'bili-mini';
    const FEED_URL = '/bili-mini/api/feed';
    const PLAY_URL = '/bili-mini/api/play';
    const ARTPLAYER_URL = '/bili-mini/vendor/artplayer.js';
    const DANMAKU_PLUGIN_URL = '/bili-mini/vendor/artplayer-plugin-danmuku.js';
    const DASH_PLAYER_URL = '/bili-mini/vendor/dash.js';

    const DICTIONARY = {
      zh: {
        panel: 'BiliMini',
        loadingSub: '正在连接 B 站…',
        updatedAt: 'B 站推荐 · 更新于 {time}',
        updatedAtPersonalized: '个性化推荐 · 更新于 {time}',
        errorSub: '加载失败',
        errorTitle: '推荐加载失败',
        emptyTitle: '暂无推荐',
        emptyBody: 'B 站暂时没有返回视频，稍后再试。',
        retry: '重试',
        refresh: '刷新推荐',
        unknownUp: '未知 UP 主',
        playerLoading: '正在获取播放地址…',
        playerScriptLoading: '正在加载播放器…',
        playerErrorTitle: '播放失败',
        playerErrorBody: '无法读取视频流，链接可能已过期。',
        playerRetry: '重试播放',
        playerClose: '关闭播放器',
        openInBili: '在 B 站打开',
        danmaku: '弹幕',
        danmakuOn: '关闭弹幕',
        danmakuOff: '打开弹幕',
        danmakuUnavailable: '弹幕不可用',
        login: '登录',
        loginTitle: '扫码登录 B 站',
        loginHint: '请使用 B 站手机客户端扫码',
        loginLoading: '正在获取二维码…',
        loginWaiting: '等待扫码…',
        loginScanned: '已扫码，请在手机上确认',
        loginExpired: '二维码已过期',
        loginFailed: '登录失败',
        loginRetry: '刷新二维码',
        loginClose: '关闭',
        loginQrAlt: 'B 站登录二维码',
        logout: '退出',
        loggedIn: '已登录',
        feedTab: '推荐',
        historyTab: '历史',
        historySub: '最近观看 · {count} 条',
        historyLoading: '正在加载历史记录…',
        historyLoginTitle: '登录后查看历史',
        historyLoginBody: '登录 B 站账号后，这里会显示最近 30 条观看记录。',
        historyEmptyTitle: '还没有观看记录',
        historyEmptyBody: '在 B 站看过的视频会出现在这里。',
        historyErrorTitle: '历史记录加载失败',
        historySync: '同步历史',
        historySyncOn: '同步历史：开',
        historySyncOff: '同步历史：关',
        quality: '画质',
        loginToUnlock: '登录后解锁',
      },
      en: {
        panel: 'BiliMini',
        loadingSub: 'Connecting to Bilibili…',
        updatedAt: 'Bilibili picks · updated {time}',
        updatedAtPersonalized: 'For you · updated {time}',
        errorSub: 'Failed to load',
        errorTitle: 'Could not load recommendations',
        emptyTitle: 'Nothing here yet',
        emptyBody: 'Bilibili returned no videos. Try again in a moment.',
        retry: 'Retry',
        refresh: 'Refresh recommendations',
        unknownUp: 'Unknown creator',
        playerLoading: 'Fetching the play address…',
        playerScriptLoading: 'Loading the player…',
        playerErrorTitle: 'Playback failed',
        playerErrorBody: 'Could not read the video stream. The link may have expired.',
        playerRetry: 'Try again',
        playerClose: 'Close player',
        openInBili: 'Open on Bilibili',
        danmaku: 'Danmaku',
        danmakuOn: 'Turn off danmaku',
        danmakuOff: 'Turn on danmaku',
        danmakuUnavailable: 'Danmaku unavailable',
        login: 'Sign in',
        loginTitle: 'Sign in to Bilibili',
        loginHint: 'Scan the code with the Bilibili mobile app',
        loginLoading: 'Getting a QR code…',
        loginWaiting: 'Waiting for scan…',
        loginScanned: 'Scanned — confirm on your phone',
        loginExpired: 'The QR code expired',
        loginFailed: 'Sign-in failed',
        loginRetry: 'New QR code',
        loginClose: 'Close',
        loginQrAlt: 'Bilibili sign-in QR code',
        logout: 'Sign out',
        loggedIn: 'Signed in',
        feedTab: 'For you',
        historyTab: 'History',
        historySub: 'Recent · {count} videos',
        historyLoading: 'Loading watch history…',
        historyLoginTitle: 'Sign in to see history',
        historyLoginBody: 'Your last 30 watched videos will appear here after signing in.',
        historyEmptyTitle: 'No watch history yet',
        historyEmptyBody: 'Videos you watch on Bilibili will show up here.',
        historyErrorTitle: 'Could not load history',
        historySync: 'Sync history',
        historySyncOn: 'Sync history: on',
        historySyncOff: 'Sync history: off',
        quality: 'Quality',
        loginToUnlock: 'sign in to unlock',
      },
    };
    let t = (key) => DICTIONARY.en[key] ?? key;
    const say = (key, vars = {}) =>
      String(t(key)).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));

    const DANMAKU_SETTINGS_KEY = 'dsh-bili-mini:danmaku-settings:v1';
    const HISTORY_SYNC_KEY = 'dsh-bili-mini:history-sync:v1';

    /**
     * Panel-scoped memory. It lives inside the client module (not on window,
     * localStorage or a cookie) and survives the panel unmounting when the
     * user switches conversations/plugins. A full page reload clears it.
     */
    const PANEL_CACHE_TTL_MS = 5 * 60 * 1000;
    const PLAYBACK_CACHE_TTL_MS = 3 * 60 * 60 * 1000;
    const panelMemory = {
      view: 'feed',
      feed: null,
      history: null,
      playback: null,
    };
    const isFresh = (entry, ttl) =>
      Boolean(entry?.at && Date.now() - entry.at < ttl);
    const DANMAKU_DEFAULTS = {
      visible: true,
      speed: 5,
      opacity: 1,
      fontSize: 25,
      modes: [0, 1, 2],
      mode: 0,
      color: '#FFFFFF',
      antiOverlap: true,
      synchronousPlayback: false,
      theme: 'dark',
      margin: [10, '25%'],
    };

    /** 16px sidebar glyph: a tiny TV with antennae and a play triangle. */
    function BiliMiniIcon() {
      return h(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        h('rect', { x: 3, y: 7, width: 18, height: 14, rx: 3 }),
        h('path', { d: 'M8 3l4 4M16 3l-4 4' }),
        h('path', { d: 'M11 11l4 3-4 3z', fill: 'currentColor', stroke: 'none' }),
      );
    }

    function RefreshIcon({ spinning }) {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          className: spinning ? 'bili-mini-spin' : undefined,
        },
        h('path', { d: 'M20 12a8 8 0 1 1-2.34-5.66' }),
        h('path', { d: 'M20 4v4h-4' }),
      );
    }

    function formatDuration(value) {
      const total = Math.max(0, Math.floor(Number(value) || 0));
      const seconds = total % 60;
      const minutes = Math.floor(total / 60) % 60;
      const hours = Math.floor(total / 3600);
      const mm = String(minutes).padStart(2, '0');
      const ss = String(seconds).padStart(2, '0');
      return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
    }

    function formatTime(value) {
      if (!Number.isFinite(value)) return '';
      try {
        return new Date(value).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {
        return '';
      }
    }

    /**
     * The desktop shell serves the page from `dsh-app://`, a custom scheme
     * whose responses Chromium cannot byte-range (electron#38749): a seek
     * collapses to zero there. The shell publishes the real HTTP origin as
     * `__DSH_TRANSPORT__.streamBaseUrl`, which is what dsh-music's audio proxy
     * uses too. In a normal browser this falls back to the page origin.
     */
    function loopbackOrigin(value) {
      try {
        const url = new URL(value);
        if (
          url.protocol === 'http:' &&
          (url.hostname === 'localhost' ||
            url.hostname === '::1' ||
            url.hostname === '[::1]')
        ) {
          // Windows proxy settings and dual-stack localhost can resolve to
          // ::1 while the host listens on 127.0.0.1 only.
          url.hostname = '127.0.0.1';
        }
        return url.origin;
      } catch {
        return '';
      }
    }

    function streamOrigin() {
      try {
        const base = window.__DSH_TRANSPORT__?.streamBaseUrl;
        if (typeof base === 'string' && base) {
          const origin = loopbackOrigin(base);
          if (origin) return origin;
        }
      } catch {
        // A malformed transport hint falls back to the document origin.
      }
      const origin = window.location?.origin;
      if (!origin || origin === 'null') return '';
      return loopbackOrigin(origin) || origin;
    }

    function absoluteStreamUrl(path) {
      if (typeof path !== 'string' || !path) return '';
      if (/^https?:\/\//i.test(path)) return path;
      const origin = streamOrigin();
      return origin ? `${origin}${path}` : path;
    }

    function numberSetting(value, min, max, fallback) {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(Math.max(n, min), max);
    }

    /** Pick only serializable, user-facing danmaku preferences. */
    function pickDanmakuSettings(option = {}) {
      const modes = Array.isArray(option.modes)
        ? [...new Set(option.modes.map(Number).filter((mode) => mode === 0 || mode === 1 || mode === 2))]
        : [...DANMAKU_DEFAULTS.modes];
      const margin =
        Array.isArray(option.margin) &&
        option.margin.length === 2 &&
        Number.isFinite(Number(option.margin[0])) &&
        (Number.isFinite(Number(option.margin[1])) ||
          /^\d+(\.\d+)?%$/.test(String(option.margin[1])))
          ? [Number(option.margin[0]), option.margin[1]]
          : [...DANMAKU_DEFAULTS.margin];

      return {
        visible:
          typeof option.visible === 'boolean'
            ? option.visible
            : DANMAKU_DEFAULTS.visible,
        speed: numberSetting(option.speed, 1, 10, DANMAKU_DEFAULTS.speed),
        opacity: numberSetting(option.opacity, 0, 1, DANMAKU_DEFAULTS.opacity),
        fontSize: numberSetting(
          option.fontSize,
          12,
          48,
          DANMAKU_DEFAULTS.fontSize,
        ),
        modes,
        mode: [0, 1, 2].includes(Number(option.mode))
          ? Number(option.mode)
          : DANMAKU_DEFAULTS.mode,
        color: /^#[0-9a-f]{6}$/i.test(String(option.color))
          ? String(option.color)
          : DANMAKU_DEFAULTS.color,
        antiOverlap:
          typeof option.antiOverlap === 'boolean'
            ? option.antiOverlap
            : DANMAKU_DEFAULTS.antiOverlap,
        synchronousPlayback:
          typeof option.synchronousPlayback === 'boolean'
            ? option.synchronousPlayback
            : DANMAKU_DEFAULTS.synchronousPlayback,
        theme:
          option.theme === 'light' || option.theme === 'dark'
            ? option.theme
            : DANMAKU_DEFAULTS.theme,
        margin,
      };
    }

    let danmakuSettings = null;
    let danmakuSaveTimer = null;

    function loadHistorySyncSetting() {
      try {
        return window.localStorage?.getItem(HISTORY_SYNC_KEY) !== '0';
      } catch {
        return true;
      }
    }

    function saveHistorySyncSetting(enabled) {
      try {
        window.localStorage?.setItem(HISTORY_SYNC_KEY, enabled ? '1' : '0');
      } catch {
        // The setting is a convenience only.
      }
    }

    function loadDanmakuSettings() {
      try {
        const raw = window.localStorage?.getItem(DANMAKU_SETTINGS_KEY);
        if (!raw) return pickDanmakuSettings(DANMAKU_DEFAULTS);
        return pickDanmakuSettings({
          ...DANMAKU_DEFAULTS,
          ...JSON.parse(raw),
        });
      } catch {
        return pickDanmakuSettings(DANMAKU_DEFAULTS);
      }
    }

    function readDanmakuSettings() {
      if (!danmakuSettings) danmakuSettings = loadDanmakuSettings();
      return danmakuSettings;
    }

    /**
     * Called on every plugin `config` event. The in-memory copy updates
     * immediately so the next video already uses it; the localStorage write is
     * debounced because sliders can emit continuously.
     */
    function rememberDanmakuSettings(option) {
      const picked = pickDanmakuSettings(option);
      danmakuSettings = picked;
      if (danmakuSaveTimer) clearTimeout(danmakuSaveTimer);
      danmakuSaveTimer = setTimeout(() => {
        danmakuSaveTimer = null;
        try {
          window.localStorage?.setItem(
            DANMAKU_SETTINGS_KEY,
            JSON.stringify(picked),
          );
        } catch {
          // localStorage may be unavailable; the session copy still works.
        }
      }, 150);
    }

    /** Fetch the host route; turn non-2xx or non-JSON answers into one message. */
    async function requestFeed(signal, force) {
      const response = await fetch(force ? `${FEED_URL}?refresh=1` : FEED_URL, {
        signal,
        headers: { accept: 'application/json' },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      return {
        items: Array.isArray(body.items) ? body.items : [],
        cached: body.cached === true,
        personalized: body.personalized === true,
        fetchedAt: Number(body.fetchedAt) || Date.now(),
      };
    }

    /** Resolve a playable stream + metadata for one card. */
    async function requestPlay(video, force, signal, qn = 64) {
      const params = new URLSearchParams({ bvid: video.bvid });
      if (video.cid) params.set('cid', String(video.cid));
      params.set('qn', String(qn));
      if (force) params.set('refresh', '1');

      const response = await fetch(`${PLAY_URL}?${params}`, {
        signal,
        headers: { accept: 'application/json' },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      return body;
    }

    async function fetchLoginStatus() {
      try {
        const response = await fetch('/bili-mini/api/login/status');
        const body = await response.json().catch(() => null);
        return {
          loggedIn: body?.loggedIn === true,
          user: body?.user ?? null,
        };
      } catch {
        return { loggedIn: false, user: null };
      }
    }

    async function fetchLoginQr(signal) {
      const response = await fetch('/bili-mini/api/login/qr', { signal });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      return body;
    }

    async function fetchLoginPoll(key, signal) {
      const response = await fetch(
        `/bili-mini/api/login/poll?key=${encodeURIComponent(key)}`,
        { signal },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      return body;
    }

    async function requestLogout() {
      try {
        await fetch('/bili-mini/api/login', { method: 'DELETE' });
      } catch {
        // Local UI state still clears; a later status read tells the truth.
      }
    }
    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.addEventListener('load', () => resolve(), { once: true });
        script.addEventListener(
          'error',
          () => {
            script.remove();
            reject(new Error(`脚本加载失败：${src}`));
          },
          { once: true },
        );
        document.head.appendChild(script);
      });
    }

    /** Load the vendored ArtPlayer UMD once, on first playback. */
    let artPromise = null;
    function loadArtPlayer() {
      if (window.Artplayer) return Promise.resolve(window.Artplayer);
      if (artPromise) return artPromise;

      artPromise = loadScript(ARTPLAYER_URL)
        .then(() => {
          if (!window.Artplayer) throw new Error('ArtPlayer 未挂到 window 上');
          return window.Artplayer;
        })
        .catch((error) => {
          artPromise = null;
          throw error;
        });

      return artPromise;
    }

    /** Load the vendored ArtPlayer danmaku plugin after the player. */
    let danmakuPromise = null;
    function loadDanmakuPlugin() {
      if (window.artplayerPluginDanmuku) {
        return Promise.resolve(window.artplayerPluginDanmuku);
      }
      if (danmakuPromise) return danmakuPromise;

      danmakuPromise = loadScript(DANMAKU_PLUGIN_URL)
        .then(() => {
          if (!window.artplayerPluginDanmuku) {
            throw new Error('弹幕插件未挂到 window 上');
          }
          return window.artplayerPluginDanmuku;
        })
        .catch((error) => {
          danmakuPromise = null;
          throw error;
        });

      return danmakuPromise;
    }

    /** Load dash.js lazily, only when a DASH stream is actually requested. */
    let dashPromise = null;
    function loadDashPlayer() {
      if (window.dashjs) return Promise.resolve(window.dashjs);
      if (dashPromise) return dashPromise;

      dashPromise = loadScript(DASH_PLAYER_URL)
        .then(() => {
          if (!window.dashjs) throw new Error('dash.js 未挂到 window 上');
          return window.dashjs;
        })
        .catch((error) => {
          dashPromise = null;
          throw error;
        });

      return dashPromise;
    }

    const DANMAKU_BUTTON_HTML =
      '<span class="bili-mini-danmaku-toggle" data-on="true">' +
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 5h16v11H9l-5 4V5z"></path>' +
      '<path d="M8 10h.01M12 10h.01M16 10h.01"></path>' +
      '</svg></span>';

    /**
     * Mount the danmaku plugin and replace its built-in toggle with one in the
     * control bar. The plugin option is `danmuku` (its spelling), while the
     * host response field is `danmaku`.
     */
    function installDanmaku(art, pluginFactory, items) {
      const settings = readDanmakuSettings();
      art.plugins.add(
        pluginFactory({
          danmuku: Array.isArray(items) ? items : [],
          ...settings,
          emitter: false,
        }),
      );

      const danmaku = art.plugins.artplayerPluginDanmuku;
      if (!danmaku) return;

      art.on('artplayerPluginDanmuku:config', rememberDanmakuSettings);

      let button = null;
      const sync = () => {
        if (!button) return;
        const on = danmaku.option.visible;
        button.dataset.on = String(on);
        button.title = on ? t('danmakuOn') : t('danmakuOff');
        button.setAttribute('aria-label', button.title);
      };

      art.controls.add({
        name: 'bili-mini-danmaku',
        position: 'right',
        index: 10,
        html: DANMAKU_BUTTON_HTML,
        tooltip: t('danmaku'),
        mounted(element) {
          button = element.querySelector('.bili-mini-danmaku-toggle');
          sync();
        },
        click() {
          danmaku.config({ visible: !danmaku.option.visible });
        },
      });

      art.on('artplayerPluginDanmuku:show', sync);
      art.on('artplayerPluginDanmuku:hide', sync);
      sync();
    }

    function Card({ item, active, onSelect }) {
      const openPlayer = (event) => {
        // Keep Ctrl/Cmd/Shift/middle-click as a normal "open on Bilibili".
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onSelect(item);
      };

      return h(
        'a',
        {
          className: `bili-mini-card${active ? ' bili-mini-card-active' : ''}`,
          href: item.url,
          target: '_blank',
          rel: 'noreferrer',
          title: item.title,
          onClick: openPlayer,
        },
        h(
          'div',
          { className: 'bili-mini-cover' },
          item.cover
            ? h('img', {
                src: item.cover,
                alt: '',
                loading: 'lazy',
                decoding: 'async',
                referrerPolicy: 'no-referrer',
                onError: (event) => {
                  event.currentTarget.style.visibility = 'hidden';
                },
              })
            : h('div', { className: 'bili-mini-noimg' }, 'BiliMini'),
          h(
            'span',
            { className: 'bili-mini-card-play', 'aria-hidden': true },
            h(
              'svg',
              { width: 34, height: 34, viewBox: '0 0 24 24' },
              h('circle', { cx: 12, cy: 12, r: 11, fill: 'rgba(0, 0, 0, 0.45)' }),
              h('path', { d: 'M10 8l6 4-6 4z', fill: '#fff' }),
            ),
          ),
          item.duration > 0
            ? h('span', { className: 'bili-mini-duration' }, formatDuration(item.duration))
            : null,
        ),
        h('div', { className: 'bili-mini-name' }, item.title),
        h(
          'div',
          { className: 'bili-mini-up' },
          item.owner?.name || t('unknownUp'),
        ),
      );
    }

    function Skeleton() {
      return h(
        'div',
        { className: 'bili-mini-grid', 'aria-busy': 'true' },
        Array.from({ length: 6 }, (_, index) =>
          h(
            'div',
            { className: 'bili-mini-card bili-mini-skeleton', key: index },
            h('div', { className: 'bili-mini-cover' }),
            h('div', { className: 'bili-mini-skel-line' }),
            h('div', { className: 'bili-mini-skel-line bili-mini-skel-short' }),
          ),
        ),
      );
    }

    function StateMessage({ title, body, action }) {
      return h(
        'div',
        { className: 'bili-mini-state', role: 'status' },
        h('div', { className: 'bili-mini-state-title' }, title),
        body ? h('div', { className: 'bili-mini-state-body' }, body) : null,
        action || null,
      );
    }

    function PlayerSection({
      video,
      play,
      onClose,
      onRetry,
      canSyncHistory,
      syncHistory,
      onToggleSyncHistory,
      resumeAt = 0,
      onTime,
      loggedIn = false,
      quality,
      availableQualities,
      onQualityChange,
      qualityBusy = false,
    }) {
      const stageRef = React.useRef(null);
      const artRef = React.useRef(null);
      const dashRef = React.useRef(null);
      const [playerReady, setPlayerReady] = React.useState(false);
      const [artError, setArtError] = React.useState('');
      const [danmakuError, setDanmakuError] = React.useState('');
      const mode = play.data?.mode === 'dash' ? 'dash' : 'mp4';
      const source =
        mode === 'dash'
          ? play.data?.manifest?.url
          : play.data?.stream?.url;
      const url = absoluteStreamUrl(source);
      const title = play.data?.title || video.title;
      const qualityText = play.data?.qualityLabel;
      const duration = play.data?.duration || video.duration;
      const loading = play.status === 'idle' || play.status === 'loading';
      const failed = play.status === 'error' || (play.status === 'ready' && Boolean(artError));
      const errorText = play.status === 'error' ? play.error : artError;
      const danmakuNote = play.data?.danmakuError || danmakuError;

      React.useEffect(() => {
        setPlayerReady(false);
        setArtError('');
        setDanmakuError('');
        if (!url || !stageRef.current) return;

        let cancelled = false;
        let art = null;

        (async () => {
          const dashPromise =
            mode === 'dash'
              ? loadDashPlayer().catch((error) => {
                  if (!cancelled) {
                    setArtError(error.message || t('playerErrorBody'));
                  }
                  return null;
                })
              : Promise.resolve(null);
          const [Artplayer, danmakuPlugin, dashjs] = await Promise.all([
            loadArtPlayer(),
            loadDanmakuPlugin().catch((error) => {
              if (!cancelled) {
                setDanmakuError(error.message || t('danmakuUnavailable'));
              }
              return null;
            }),
            dashPromise,
          ]);

          if (cancelled || !stageRef.current) return;
          if (mode === 'dash' && !dashjs) return;

          art = new Artplayer({
            container: stageRef.current,
            url,
            type: mode === 'dash' ? 'dash' : 'mp4',
            customType:
              mode === 'dash'
                ? {
                    dash: (videoElement, manifestUrl) => {
                      const instance = dashjs.MediaPlayer().create();
                      dashRef.current = instance;
                      instance.on('error', () => {
                        if (!cancelled) setArtError(t('playerErrorBody'));
                      });
                      instance.initialize(videoElement, manifestUrl, true);
                    },
                  }
                : {},
            autoplay: true,
            volume: 0.8,
            autoSize: true,
            theme: '#00AEEC',
            lang: navigator.language?.startsWith('zh') ? 'zh-cn' : 'en',
            pip: true,
            fullscreen: true,
            setting: true,
            playbackRate: true,
            aspectRatio: true,
            hotkey: true,
            airplay: true,
            moreVideoAttr: { playsInline: true },
          });
          artRef.current = art;

          art.on('ready', () => {
            if (cancelled) return;
            setPlayerReady(true);
            setArtError('');
            if (resumeAt > 0) {
              const target = Math.max(
                0,
                Math.min(
                  Number(resumeAt) || 0,
                  Number(art.duration) || Number(resumeAt) || 0,
                ),
              );
              try {
                art.currentTime = target;
              } catch {
                // The media element may still be settling; timeupdate will
                // continue from the previous position if seek fails.
              }
              art.play().catch(() => {});
            }
          });
          art.on('error', () => {
            if (!cancelled) setArtError(t('playerErrorBody'));
          });

          if (danmakuPlugin) {
            try {
              installDanmaku(art, danmakuPlugin, play.data?.danmaku || []);
            } catch (error) {
              if (!cancelled) {
                setDanmakuError(error.message || t('danmakuUnavailable'));
              }
            }
          }
        })().catch((error) => {
          if (!cancelled) setArtError(error.message || t('playerErrorBody'));
        });

        return () => {
          cancelled = true;
          if (dashRef.current) {
            try {
              dashRef.current.destroy();
            } catch {
              // dash.js may already be disposed by the player teardown.
            }
            dashRef.current = null;
          }
          if (artRef.current === art) artRef.current = null;
          if (art) {
            try {
              art.destroy();
            } catch {
              // The instance may already be disposed by a fullscreen teardown.
            }
          } else if (stageRef.current) {
            stageRef.current.innerHTML = '';
          }
        };
      }, [url, mode]);

      // Keep the latest playback position outside React state so a quality
      // switch can resume at the current timestamp without re-rendering on
      // every timeupdate.
      React.useEffect(() => {
        if (!playerReady || !onTime) return;
        const element =
          artRef.current?.video || stageRef.current?.querySelector('video');
        if (!element) return;
        const handle = () => onTime(element.currentTime);
        element.addEventListener('timeupdate', handle);
        handle();
        return () => element.removeEventListener('timeupdate', handle);
      }, [playerReady, url, onTime]);

      // Best-effort watch-progress reporting. This never surfaces an error in
      // the UI and never touches the cookie: the backend adds SESSDATA + csrf.
      React.useEffect(() => {
        if (!canSyncHistory || !syncHistory || !playerReady || !url) return;

        const art = artRef.current;
        const element =
          art?.video || stageRef.current?.querySelector('video');
        if (!element) return;

        const bvid = play.data?.bvid || video.bvid;
        const aid = Number(play.data?.aid) || 0;
        const cid = Number(play.data?.cid) || Number(video.cid) || 0;
        if (!bvid || !aid || !cid) return;

        const startedEpoch = Math.floor(Date.now() / 1000);
        let startedAt = 0;
        let lastSentAt = 0;
        let lastKnown = Math.max(
          0,
          Math.floor(Number(element.currentTime) || 0),
        );
        let disposed = false;
        let ended = false;

        const post = (event, playedTime, keepalive = false) => {
          const duration = Math.max(
            0,
            Math.floor(
              Number(element.duration) ||
                Number(play.data?.duration) ||
                Number(video.duration) ||
                0,
            ),
          );
          const played = Math.max(
            0,
            Math.min(
              Math.floor(Number(playedTime) || 0),
              duration || 86_400,
            ),
          );
          fetch('/bili-mini/api/history/report', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              bvid,
              aid,
              cid,
              playedTime: played,
              duration,
              realPlayedTime: played,
              startTs: startedAt || startedEpoch,
              event,
            }),
            keepalive,
          }).catch(() => {
            // Silent by design: history sync must never disturb playback.
          });
        };

        const sendCurrent = (event, keepalive = false) => {
          const current = Math.max(
            lastKnown,
            Math.floor(Number(element.currentTime) || 0),
          );
          lastKnown = current;
          post(event, current, keepalive);
        };

        const onPlay = () => {
          if (disposed) return;
          if (!startedAt) startedAt = Math.floor(Date.now() / 1000);
          lastSentAt = Date.now();
          sendCurrent('start');
        };

        const onTimeUpdate = () => {
          if (disposed) return;
          lastKnown = Math.max(
            lastKnown,
            Math.floor(Number(element.currentTime) || 0),
          );
          if (element.paused || element.ended) return;
          if (!startedAt) {
            startedAt = Math.floor(Date.now() / 1000);
            lastSentAt = Date.now();
            sendCurrent('start');
            return;
          }
          const now = Date.now();
          if (now - lastSentAt >= 20_000) {
            lastSentAt = now;
            sendCurrent('heartbeat');
          }
        };

        const onPause = () => {
          if (disposed) return;
          lastSentAt = Date.now();
          sendCurrent('pause');
        };

        const onEnded = () => {
          if (disposed || ended) return;
          ended = true;
          lastSentAt = Date.now();
          sendCurrent('end', true);
        };

        const onSeeked = () => {
          if (disposed) return;
          lastSentAt = Date.now();
          sendCurrent('heartbeat');
        };

        element.addEventListener('play', onPlay);
        element.addEventListener('timeupdate', onTimeUpdate);
        element.addEventListener('pause', onPause);
        element.addEventListener('ended', onEnded);
        element.addEventListener('seeked', onSeeked);

        // ArtPlayer is configured with autoplay; the play event may have fired
        // before this effect attached.
        if (!element.paused && !element.ended) {
          startedAt = startedAt || Math.floor(Date.now() / 1000);
          lastSentAt = Date.now();
          sendCurrent('start');
        }

        return () => {
          disposed = true;
          element.removeEventListener('play', onPlay);
          element.removeEventListener('timeupdate', onTimeUpdate);
          element.removeEventListener('pause', onPause);
          element.removeEventListener('ended', onEnded);
          element.removeEventListener('seeked', onSeeked);
          const current = Math.max(
            lastKnown,
            Math.floor(Number(element.currentTime) || 0),
          );
          if (current > 0) post('close', current, true);
        };
      }, [
        canSyncHistory,
        syncHistory,
        playerReady,
        url,
        play.data?.aid,
        play.data?.bvid,
        play.data?.cid,
        play.data?.duration,
        video.bvid,
        video.cid,
        video.duration,
      ]);

      const qualityOptions = [];
      const availableMap = new Map();
      for (const entry of Array.isArray(availableQualities)
        ? availableQualities
        : []) {
        if (entry?.qn === 64 || entry?.qn === 80) {
          availableMap.set(entry.qn, entry.label || (entry.qn === 64 ? '720P' : '1080P'));
        }
      }
      const currentQuality =
        Number(quality) || Number(play.data?.quality) || 64;

      if (availableMap.has(64)) {
        qualityOptions.push({ qn: 64, label: availableMap.get(64), locked: false });
      }
      if (loggedIn && availableMap.has(80)) {
        qualityOptions.push({ qn: 80, label: availableMap.get(80), locked: false });
      } else if (loggedIn && play.data?.mode !== 'dash') {
        // The current play was requested while anonymous (MP4 720P). After
        // signing in, expose 1080P so the next request can switch to DASH.
        qualityOptions.push({ qn: 80, label: '1080P', locked: false });
      }
      if (!loggedIn) {
        qualityOptions.push({ qn: 80, label: '1080P', locked: true });
      }
      if (!qualityOptions.some((option) => option.qn === currentQuality)) {
        qualityOptions.push({
          qn: currentQuality,
          label: play.data?.qualityLabel || `Q${currentQuality}`,
          locked: false,
        });
      }
      qualityOptions.sort((a, b) => a.qn - b.qn);

      return h(
        'section',
        { className: 'bili-mini-player', 'aria-label': title },
        h(
          'div',
          { className: 'bili-mini-player-head' },
          h('div', { className: 'bili-mini-player-title', title }, title),
          h(
            'div',
            { className: 'bili-mini-player-head-actions' },
            h(
              'select',
              {
                className: 'bili-mini-quality',
                value: String(currentQuality),
                disabled:
                  qualityBusy || play.status !== 'ready' || !playerReady,
                title: t('quality'),
                'aria-label': t('quality'),
                onChange: (event) => {
                  const next = Number(event.target.value);
                  if (!next || next === currentQuality) return;
                  const option = qualityOptions.find(
                    (entry) => entry.qn === next,
                  );
                  if (!option || option.locked) return;
                  onQualityChange?.(next);
                },
              },
              qualityOptions.map((option) =>
                h(
                  'option',
                  {
                    key: option.qn,
                    value: String(option.qn),
                    disabled: option.locked,
                  },
                  option.locked
                    ? `${option.label}（${t('loginToUnlock')}）`
                    : option.label,
                ),
              ),
            ),
            canSyncHistory
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: `bili-mini-sync${
                      syncHistory ? ' is-on' : ''
                    }`,
                    onClick: () => onToggleSyncHistory(!syncHistory),
                    title: syncHistory
                      ? t('historySyncOn')
                      : t('historySyncOff'),
                    'aria-label': syncHistory
                      ? t('historySyncOn')
                      : t('historySyncOff'),
                    'aria-pressed': syncHistory,
                  },
                  h('span', { className: 'bili-mini-sync-dot' }),
                  h('span', null, t('historySync')),
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'bili-mini-player-close',
                onClick: onClose,
                title: t('playerClose'),
                'aria-label': t('playerClose'),
              },
              h(
                'svg',
                {
                  width: 14,
                  height: 14,
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 1.8,
                  strokeLinecap: 'round',
                  'aria-hidden': true,
                },
                h('path', { d: 'M6 6l12 12M18 6L6 18' }),
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'bili-mini-player-stage-wrap' },
          h('div', { className: 'bili-mini-player-stage', ref: stageRef }),
          loading
            ? h(
                'div',
                { className: 'bili-mini-player-overlay' },
                h('span', { className: 'bili-mini-player-spinner bili-mini-spin' }),
                h('div', { className: 'bili-mini-player-overlay-body' }, t('playerLoading')),
              )
            : null,
          failed
            ? h(
                'div',
                { className: 'bili-mini-player-overlay' },
                h('div', { className: 'bili-mini-player-overlay-title' }, t('playerErrorTitle')),
                h(
                  'div',
                  { className: 'bili-mini-player-overlay-body' },
                  errorText || t('playerErrorBody'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'bili-mini-player-action', onClick: onRetry },
                  t('playerRetry'),
                ),
                h(
                  'a',
                  {
                    className: 'bili-mini-player-link',
                    href: video.url,
                    target: '_blank',
                    rel: 'noreferrer',
                  },
                  t('openInBili'),
                ),
              )
            : null,
          !loading && !failed && !playerReady
            ? h(
                'div',
                { className: 'bili-mini-player-overlay bili-mini-player-overlay-soft' },
                h('span', { className: 'bili-mini-player-spinner bili-mini-spin' }),
                h('div', { className: 'bili-mini-player-overlay-body' }, t('playerScriptLoading')),
              )
            : null,
        ),
        h(
          'div',
          { className: 'bili-mini-player-meta' },
          h(
            'div',
            { className: 'bili-mini-player-facts' },
            qualityText
              ? h('span', { className: 'bili-mini-player-chip' }, qualityText)
              : null,
            duration > 0 ? h('span', null, formatDuration(duration)) : null,
            danmakuNote
              ? h(
                  'span',
                  {
                    className: 'bili-mini-player-chip bili-mini-player-chip-warn',
                    title: danmakuNote,
                  },
                  t('danmakuUnavailable'),
                )
              : null,
          ),
          h(
            'a',
            {
              className: 'bili-mini-player-link',
              href: video.url,
              target: '_blank',
              rel: 'noreferrer',
            },
            t('openInBili'),
          ),
        ),
      );
    }

    function LoginModal({ qr, state, error, onClose, onRetry }) {
      const statusText =
        state === 'loading'
          ? t('loginLoading')
          : state === 'scanned'
            ? t('loginScanned')
            : state === 'expired'
              ? t('loginExpired')
              : state === 'error'
                ? t('loginFailed')
                : t('loginWaiting');

      return h(
        'div',
        {
          className: 'bili-mini-modal-backdrop',
          role: 'presentation',
          onClick: onClose,
        },
        h(
          'div',
          {
            className: 'bili-mini-modal',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('loginTitle'),
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'div',
            { className: 'bili-mini-modal-head' },
            h('div', { className: 'bili-mini-modal-title' }, t('loginTitle')),
            h(
              'button',
              {
                type: 'button',
                className: 'bili-mini-player-close bili-mini-modal-close',
                onClick: onClose,
                title: t('loginClose'),
                'aria-label': t('loginClose'),
              },
              h(
                'svg',
                {
                  width: 14,
                  height: 14,
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 1.8,
                  strokeLinecap: 'round',
                  'aria-hidden': true,
                },
                h('path', { d: 'M6 6l12 12M18 6L6 18' }),
              ),
            ),
          ),
          qr?.image
            ? h('img', {
                className: 'bili-mini-qr',
                src: qr.image,
                width: 200,
                height: 200,
                alt: t('loginQrAlt'),
              })
            : h(
                'div',
                { className: 'bili-mini-qr-placeholder' },
                state === 'loading'
                  ? h('span', { className: 'bili-mini-modal-spinner bili-mini-spin' })
                  : null,
                h(
                  'span',
                  null,
                  state === 'loading' ? t('loginLoading') : t('loginFailed'),
                ),
              ),
          h(
            'div',
            {
              className: 'bili-mini-modal-status',
              role: 'status',
              'aria-live': 'polite',
            },
            statusText,
          ),
          state === 'waiting' || state === 'scanned'
            ? h('div', { className: 'bili-mini-modal-hint' }, t('loginHint'))
            : null,
          error ? h('div', { className: 'bili-mini-modal-error' }, error) : null,
          state === 'expired' || state === 'error' || (!qr && state !== 'loading')
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'bili-mini-modal-button',
                  onClick: onRetry,
                },
                t('loginRetry'),
              )
            : null,
        ),
      );
    }

    function BiliMiniPanel() {
      const initialPlayback = isFresh(
        panelMemory.playback,
        PLAYBACK_CACHE_TTL_MS,
      )
        ? panelMemory.playback
        : null;
      const feedCache = panelMemory.feed;
      const historyCache = panelMemory.history;

      const [state, setState] = React.useState(
        feedCache
          ? {
              status: 'ok',
              items: feedCache.items,
              error: '',
              personalized: feedCache.personalized,
              fetchedAt: feedCache.fetchedAt,
            }
          : {
              status: 'loading',
              items: [],
              error: '',
              personalized: false,
              fetchedAt: 0,
            },
      );
      const [refreshing, setRefreshing] = React.useState(false);
      const abortRef = React.useRef(null);
      const playAbortRef = React.useRef(null);
      const rootRef = React.useRef(null);
      const [selected, setSelected] = React.useState(
        initialPlayback?.selected || null,
      );
      const [play, setPlay] = React.useState(
        initialPlayback?.play || {
          status: 'idle',
          data: null,
          error: '',
        },
      );
      const [user, setUser] = React.useState(null);
      const [loginOpen, setLoginOpen] = React.useState(false);
      const [loginState, setLoginState] = React.useState('idle');
      const [loginError, setLoginError] = React.useState('');
      const [qr, setQr] = React.useState(null);
      const loginTimerRef = React.useRef(null);
      const loginAbortRef = React.useRef(null);
      const loginOpenRef = React.useRef(false);
      const [view, setView] = React.useState(
        () => panelMemory.view || 'feed',
      );
      const [history, setHistory] = React.useState(
        historyCache
          ? {
              status: 'ok',
              items: historyCache.items,
              error: '',
              needsLogin: false,
            }
          : {
              status: 'idle',
              items: [],
              error: '',
              needsLogin: false,
            },
      );
      const historyAbortRef = React.useRef(null);
      const [syncHistory, setSyncHistory] = React.useState(
        loadHistorySyncSetting,
      );
      const initialQuality =
        initialPlayback?.quality ||
        initialPlayback?.play?.data?.quality ||
        64;
      const [quality, setQuality] = React.useState(initialQuality);
      const [qualityBusy, setQualityBusy] = React.useState(false);
      const [resumeAt, setResumeAt] = React.useState(
        initialPlayback?.currentTime || 0,
      );
      const qualityAbortRef = React.useRef(null);
      const qualityRef = React.useRef(initialQuality);
      const selectedRef = React.useRef(initialPlayback?.selected || null);
      const playTimeRef = React.useRef(initialPlayback?.currentTime || 0);

      React.useEffect(() => {
        qualityRef.current = quality;
      }, [quality]);

      React.useEffect(() => {
        if (play.status === 'ready' && play.data?.quality) {
          setQuality(play.data.quality);
        }
      }, [play.status, play.data?.quality]);

      // Persist an open playback session for panel remounts. The timestamp is
      // the play response time, matching the 3h stream/manifest token TTL, so
      // remounting cannot keep an expired token alive indefinitely.
      React.useEffect(() => {
        if (!selected) {
          panelMemory.playback = null;
          return;
        }
        if (play.status !== 'ready' || !play.data) return;
        panelMemory.playback = {
          selected,
          play,
          currentTime: playTimeRef.current,
          quality: play.data.quality || quality,
          at: Number(play.data.fetchedAt) || Date.now(),
        };
      }, [selected, play, quality]);

      const load = React.useCallback(async (isRefresh) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        if (isRefresh) {
          setRefreshing(true);
        } else {
          setState({
            status: 'loading',
            items: [],
            error: '',
            personalized: false,
            fetchedAt: 0,
          });
        }

        try {
          const feed = await requestFeed(controller.signal, isRefresh);
          if (!controller.signal.aborted) {
            panelMemory.feed = {
              items: feed.items,
              personalized: feed.personalized,
              fetchedAt: feed.fetchedAt,
              at: Date.now(),
            };
            setState({
              status: 'ok',
              items: feed.items,
              error: '',
              personalized: feed.personalized,
              fetchedAt: feed.fetchedAt,
            });
          }
        } catch (error) {
          if (error.name !== 'AbortError' && !controller.signal.aborted) {
            setState({
              status: 'error',
              items: [],
              error: error.message,
              personalized: false,
              fetchedAt: 0,
            });
          }
        } finally {
          if (!controller.signal.aborted) setRefreshing(false);
        }
      }, []);

      const startPlay = React.useCallback((video, force = false) => {
        qualityAbortRef.current?.abort();
        qualityAbortRef.current = null;
        setQualityBusy(false);

        if (selectedRef.current?.bvid !== video.bvid) {
          playTimeRef.current = 0;
          setResumeAt(0);
          panelMemory.playback = null;
        }
        selectedRef.current = video;

        playAbortRef.current?.abort();
        const controller = new AbortController();
        playAbortRef.current = controller;

        setSelected(video);
        setPlay({ status: 'loading', data: null, error: '' });

        requestPlay(video, force, controller.signal, qualityRef.current)
          .then((data) => {
            if (!controller.signal.aborted) {
              setPlay({ status: 'ready', data, error: '' });
            }
          })
          .catch((error) => {
            if (error.name !== 'AbortError' && !controller.signal.aborted) {
              setPlay({ status: 'error', data: null, error: error.message });
            }
          });

        requestAnimationFrame(() => {
          rootRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }, []);

      const closePlayer = () => {
        qualityAbortRef.current?.abort();
        qualityAbortRef.current = null;
        setQualityBusy(false);
        playAbortRef.current?.abort();
        playTimeRef.current = 0;
        selectedRef.current = null;
        panelMemory.playback = null;
        setResumeAt(0);
        setSelected(null);
        setPlay({ status: 'idle', data: null, error: '' });
      };

      const retryPlay = () => {
        if (!selected) return;
        setResumeAt(playTimeRef.current);
        startPlay(selected, true);
      };

      const rememberPlayTime = React.useCallback((value) => {
        const time = Number(value);
        if (Number.isFinite(time) && time >= 0) {
          playTimeRef.current = time;
          if (panelMemory.playback) {
            panelMemory.playback.currentTime = time;
          }
        }
      }, []);

      const switchQuality = async (nextQn) => {
        if (!selected || !play.data) return;
        if (nextQn === play.data.quality) return;
        if (nextQn > 64 && !user) return;

        qualityAbortRef.current?.abort();
        const controller = new AbortController();
        qualityAbortRef.current = controller;
        setQualityBusy(true);

        try {
          const data = await requestPlay(
            selected,
            true,
            controller.signal,
            nextQn,
          );
          if (controller.signal.aborted) return;

          const at = playTimeRef.current;
          if (
            data.quality === play.data.quality &&
            data.mode === play.data.mode
          ) {
            setQuality(data.quality);
            return;
          }

          setQuality(data.quality || nextQn);
          setResumeAt(at);
          setPlay({ status: 'ready', data, error: '' });
        } catch (error) {
          if (error.name !== 'AbortError' && !controller.signal.aborted) {
            // Keep the current playback; quality switching is best-effort.
          }
        } finally {
          if (!controller.signal.aborted) setQualityBusy(false);
        }
      };

      const loadHistory = React.useCallback(async (force = false) => {
        const cache = panelMemory.history;
        if (!force && isFresh(cache, PANEL_CACHE_TTL_MS)) {
          setHistory({
            status: 'ok',
            items: cache.items,
            error: '',
            needsLogin: false,
          });
          return;
        }

        historyAbortRef.current?.abort();
        const controller = new AbortController();
        historyAbortRef.current = controller;
        setHistory({
          status: 'loading',
          items: [],
          error: '',
          needsLogin: false,
        });

        try {
          const response = await fetch('/bili-mini/api/history', {
            signal: controller.signal,
          });
          const body = await response.json().catch(() => null);
          if (!response.ok || !body?.ok) {
            if (response.status === 401 || body?.needsLogin) {
              if (!controller.signal.aborted) {
                setHistory({
                  status: 'login',
                  items: [],
                  error: '',
                  needsLogin: true,
                });
              }
              return;
            }
            throw new Error(body?.error || `HTTP ${response.status}`);
          }
          if (!controller.signal.aborted) {
            const items = Array.isArray(body.items) ? body.items : [];
            panelMemory.history = { items, at: Date.now() };
            setHistory({
              status: 'ok',
              items,
              error: '',
              needsLogin: false,
            });
          }
        } catch (error) {
          if (error.name !== 'AbortError' && !controller.signal.aborted) {
            setHistory({
              status: 'error',
              items: [],
              error: error.message,
              needsLogin: false,
            });
          }
        }
      }, []);

      const showFeed = () => {
        panelMemory.view = 'feed';
        historyAbortRef.current?.abort();
        setView('feed');
      };

      const showHistory = () => {
        panelMemory.view = 'history';
        setView('history');
        loadHistory(false);
      };

      const toggleHistorySync = (enabled) => {
        setSyncHistory(enabled);
        saveHistorySyncSetting(enabled);
      };

      const stopLoginPolling = () => {
        if (loginTimerRef.current) {
          clearTimeout(loginTimerRef.current);
          loginTimerRef.current = null;
        }
        loginAbortRef.current?.abort();
        loginAbortRef.current = null;
      };

      const scheduleLoginPoll = (key) => {
        if (loginTimerRef.current) clearTimeout(loginTimerRef.current);
        loginTimerRef.current = setTimeout(async () => {
          if (!loginOpenRef.current) return;

          const controller = new AbortController();
          loginAbortRef.current?.abort();
          loginAbortRef.current = controller;

          try {
            const body = await fetchLoginPoll(key, controller.signal);
            if (!loginOpenRef.current || controller.signal.aborted) return;

            if (body.status === 'success') {
              stopLoginPolling();
              loginOpenRef.current = false;
              setLoginOpen(false);
              setLoginState('idle');
              setLoginError('');
              setUser(body.user || { mid: 0, name: t('loggedIn'), face: '' });
              panelMemory.feed = null;
              panelMemory.history = null;
              void load(true);
              if (view === 'history') void loadHistory(true);
              return;
            }

            if (body.status === 'expired' || body.status === 'error') {
              stopLoginPolling();
              setLoginState(body.status);
              setLoginError(body.message || '');
              return;
            }

            setLoginState(body.status);
            scheduleLoginPoll(key);
          } catch (error) {
            if (error.name === 'AbortError' || controller.signal.aborted) return;
            if (!loginOpenRef.current) return;
            stopLoginPolling();
            setLoginState('error');
            setLoginError(error.message);
          }
        }, 2000);
      };

      const openLogin = async () => {
        loginOpenRef.current = true;
        setLoginOpen(true);
        setLoginState('loading');
        setLoginError('');
        setQr(null);
        stopLoginPolling();

        const controller = new AbortController();
        loginAbortRef.current = controller;
        try {
          const body = await fetchLoginQr(controller.signal);
          if (!loginOpenRef.current || controller.signal.aborted) return;
          setQr({ key: body.key, image: body.image });
          setLoginState('waiting');
          scheduleLoginPoll(body.key);
        } catch (error) {
          if (error.name === 'AbortError' || controller.signal.aborted) return;
          if (!loginOpenRef.current) return;
          setLoginState('error');
          setLoginError(error.message);
        }
      };

      const closeLogin = () => {
        loginOpenRef.current = false;
        setLoginOpen(false);
        setLoginState('idle');
        setLoginError('');
        setQr(null);
        stopLoginPolling();
      };

      const logout = async () => {
        await requestLogout();
        setUser(null);
        closeLogin();
        panelMemory.feed = null;
        panelMemory.history = null;
        if (view === 'history') {
          historyAbortRef.current?.abort();
          setHistory({
            status: 'login',
            items: [],
            error: '',
            needsLogin: true,
          });
        }
        void load(true);
      };

      React.useEffect(() => {
        let cancelled = false;
        fetchLoginStatus().then((status) => {
          if (cancelled) return;
          const next = status.loggedIn
            ? status.user || { mid: 0, name: t('loggedIn'), face: '' }
            : null;
          setUser((current) => current || next);
        });
        return () => {
          cancelled = true;
        };
      }, []);

      React.useEffect(() => {
        return () => {
          loginOpenRef.current = false;
          stopLoginPolling();
        };
      }, []);

      React.useEffect(() => {
        if (!loginOpen) return;
        const onKey = (event) => {
          if (event.key === 'Escape') closeLogin();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [loginOpen]);

      React.useEffect(() => {
        if (isFresh(panelMemory.feed, PANEL_CACHE_TTL_MS)) return;
        load(Boolean(panelMemory.feed));
        return () => abortRef.current?.abort();
      }, [load]);

      React.useEffect(() => {
        if (view === 'history') loadHistory(false);
        return () => historyAbortRef.current?.abort();
      }, []);

      React.useEffect(() => () => playAbortRef.current?.abort(), []);
      React.useEffect(() => () => qualityAbortRef.current?.abort(), []);
      React.useEffect(() => () => historyAbortRef.current?.abort(), []);

      const subtitle =
        view === 'history'
          ? history.status === 'ok'
            ? say('historySub', { count: history.items.length })
            : history.status === 'login'
              ? t('historyLoginTitle')
              : history.status === 'error'
                ? t('errorSub')
                : t('historyLoading')
          : state.status === 'ok'
            ? say(state.personalized ? 'updatedAtPersonalized' : 'updatedAt', {
                time: formatTime(state.fetchedAt),
              })
            : state.status === 'error'
              ? t('errorSub')
              : t('loadingSub');

      let content;
      if (view === 'history') {
        if (history.status === 'loading' || history.status === 'idle') {
          content = h(Skeleton);
        } else if (history.status === 'login') {
          content = h(StateMessage, {
            title: t('historyLoginTitle'),
            body: t('historyLoginBody'),
            action: h(
              'button',
              {
                type: 'button',
                className: 'bili-mini-retry',
                onClick: openLogin,
              },
              t('login'),
            ),
          });
        } else if (history.status === 'error') {
          content = h(StateMessage, {
            title: t('historyErrorTitle'),
            body: history.error,
            action: h(
              'button',
              {
                type: 'button',
                className: 'bili-mini-retry',
                onClick: () => loadHistory(true),
              },
              t('retry'),
            ),
          });
        } else if (history.items.length === 0) {
          content = h(StateMessage, {
            title: t('historyEmptyTitle'),
            body: t('historyEmptyBody'),
          });
        } else {
          content = h(
            'div',
            { className: 'bili-mini-grid' },
            history.items.map((item) =>
              h(Card, {
                item,
                key: item.bvid,
                active: selected?.bvid === item.bvid,
                onSelect: startPlay,
              }),
            ),
          );
        }
      } else if (state.status === 'loading') {
        content = h(Skeleton);
      } else if (state.status === 'error') {
        content = h(StateMessage, {
          title: t('errorTitle'),
          body: state.error,
          action: h(
            'button',
            {
              type: 'button',
              className: 'bili-mini-retry',
              onClick: () => load(false),
            },
            t('retry'),
          ),
        });
      } else if (state.items.length === 0) {
        content = h(StateMessage, {
          title: t('emptyTitle'),
          body: t('emptyBody'),
          action: h(
            'button',
            {
              type: 'button',
              className: 'bili-mini-retry',
              onClick: () => load(false),
            },
            t('retry'),
          ),
        });
      } else {
        content = h(
          'div',
          { className: 'bili-mini-grid' },
          state.items.map((item) =>
            h(Card, {
              item,
              key: item.bvid,
              active: selected?.bvid === item.bvid,
              onSelect: startPlay,
            }),
          ),
        );
      }

      return h(
        React.Fragment,
        null,
        h('style', null, STYLE),
        h(
          'div',
          { className: 'bili-mini-root', ref: rootRef },
          h(
            'div',
            { className: 'bili-mini-head' },
            h(
              'div',
              { className: 'bili-mini-heading' },
              h('div', { className: 'bili-mini-title' }, 'BiliMini'),
              h('div', { className: 'bili-mini-sub', role: 'status' }, subtitle),
            ),
            h(
              'div',
              { className: 'bili-mini-actions' },
              h(
                'div',
                {
                  className: 'bili-mini-tabs',
                  role: 'tablist',
                  'aria-label': 'BiliMini',
                },
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'tab',
                    'aria-selected': view === 'feed',
                    className: `bili-mini-tab${view === 'feed' ? ' is-active' : ''}`,
                    onClick: showFeed,
                  },
                  t('feedTab'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'tab',
                    'aria-selected': view === 'history',
                    className: `bili-mini-tab${view === 'history' ? ' is-active' : ''}`,
                    onClick: showHistory,
                  },
                  t('historyTab'),
                ),
              ),
              user
                ? h(
                    'div',
                    { className: 'bili-mini-user' },
                    h(
                      'span',
                      { className: 'bili-mini-avatar' },
                      h(
                        'span',
                        { className: 'bili-mini-avatar-fallback' },
                        Array.from((user.name || 'B').trim())[0] || 'B',
                      ),
                      user.face
                        ? h('img', {
                            src: user.face,
                            alt: '',
                            referrerPolicy: 'no-referrer',
                            onError: (event) => {
                              event.currentTarget.style.display = 'none';
                            },
                          })
                        : null,
                    ),
                    h(
                      'span',
                      {
                        className: 'bili-mini-user-name',
                        title: user.name || t('loggedIn'),
                      },
                      user.name || t('loggedIn'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'bili-mini-logout',
                        onClick: logout,
                        title: t('logout'),
                        'aria-label': t('logout'),
                      },
                      t('logout'),
                    ),
                  )
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'bili-mini-login',
                      onClick: openLogin,
                      title: t('login'),
                      'aria-label': t('login'),
                    },
                    h(
                      'svg',
                      {
                        width: 14,
                        height: 14,
                        viewBox: '0 0 24 24',
                        fill: 'none',
                        stroke: 'currentColor',
                        strokeWidth: 1.7,
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round',
                        'aria-hidden': true,
                      },
                      h('circle', { cx: 12, cy: 8, r: 4 }),
                      h('path', { d: 'M4 21c0-4 3.6-7 8-7s8 3 8 7' }),
                    ),
                    h('span', null, t('login')),
                  ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'bili-mini-refresh',
                  onClick: () =>
                    view === 'history' ? loadHistory(true) : load(true),
                  disabled:
                    view === 'history'
                      ? history.status === 'loading'
                      : refreshing || state.status === 'loading',
                  title: t('refresh'),
                  'aria-label': t('refresh'),
                },
                h(RefreshIcon, {
                  spinning:
                    view === 'history'
                      ? history.status === 'loading'
                      : refreshing,
                }),
              ),
            ),
          ),
          selected
            ? h(PlayerSection, {
                key: selected.bvid,
                video: selected,
                play,
                onClose: closePlayer,
                onRetry: retryPlay,
                canSyncHistory: Boolean(user),
                syncHistory,
                onToggleSyncHistory: toggleHistorySync,
                resumeAt,
                onTime: rememberPlayTime,
                loggedIn: Boolean(user),
                quality: play.data?.quality || quality,
                availableQualities: play.data?.availableQualities || [],
                onQualityChange: switchQuality,
                qualityBusy,
              })
            : null,
          content,
        ),
        loginOpen
          ? h(LoginModal, {
              qr,
              state: loginState,
              error: loginError,
              onClose: closeLogin,
              onRetry: openLogin,
            })
          : null,
      );
    }

    const STYLE = `
.bili-mini-root {
  box-sizing: border-box;
  height: 100%;
  overflow: auto;
  padding: 20px 22px 32px;
  color: var(--dsw-alias-label-primary, #1f2329);
  font: 13px/1.55 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.bili-mini-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.bili-mini-heading {
  min-width: 0;
}
.bili-mini-title {
  font-size: 15px;
  font-weight: 650;
  line-height: 1.3;
}
.bili-mini-sub {
  margin-top: 3px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bili-mini-actions {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
}
.bili-mini-tabs {
  display: inline-flex;
  flex: none;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.04));
}
.bili-mini-tab {
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  line-height: 22px;
}
.bili-mini-tab:hover {
  color: var(--dsw-alias-label-primary, #1f2329);
}
.bili-mini-tab.is-active {
  background: var(--dsw-alias-bg-base, #fff);
  color: var(--dsw-alias-label-primary, #1f2329);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.bili-mini-login,
.bili-mini-logout {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #5c636b);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.bili-mini-login:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--dsw-alias-label-primary, #1f2329);
}
.bili-mini-user {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.bili-mini-avatar {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  overflow: hidden;
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-secondary, #5c636b);
  font-size: 11px;
  font-weight: 600;
}
.bili-mini-avatar-fallback {
  line-height: 1;
}
.bili-mini-avatar img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.bili-mini-user-name {
  max-width: 110px;
  overflow: hidden;
  color: var(--dsw-alias-label-primary, #1f2329);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bili-mini-logout {
  height: 24px;
  padding: 0 6px;
  border-color: transparent;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 11px;
}
.bili-mini-logout:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--dsw-alias-label-primary, #1f2329);
}
.bili-mini-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 20px;
  background: rgba(0, 0, 0, 0.48);
}
.bili-mini-modal {
  box-sizing: border-box;
  width: 300px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 40px);
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  border-radius: 14px;
  background: var(--dsw-alias-bg-base, #fff);
  color: var(--dsw-alias-label-primary, #1f2329);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  text-align: center;
}
.bili-mini-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  text-align: left;
}
.bili-mini-modal-title {
  font-size: 14px;
  font-weight: 650;
}
.bili-mini-modal-close {
  flex: none;
}
.bili-mini-qr {
  display: block;
  width: 200px;
  height: 200px;
  margin: 14px auto 10px;
  border-radius: 8px;
  background: #fff;
}
.bili-mini-qr-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 200px;
  height: 200px;
  box-sizing: border-box;
  margin: 14px auto 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 12px;
}
.bili-mini-modal-spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.15));
  border-top-color: var(--dsw-alias-brand-primary, #00aeec);
  border-radius: 50%;
}
.bili-mini-modal-status {
  min-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c636b);
  font-size: 12px;
}
.bili-mini-modal-hint {
  margin-top: 4px;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 11px;
}
.bili-mini-modal-error {
  margin-top: 6px;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-state-error-primary, #d33);
  font-size: 11px;
  line-height: 1.5;
}
.bili-mini-modal-button {
  margin-top: 12px;
  padding: 6px 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.03));
  color: var(--dsw-alias-label-primary, #1f2329);
  cursor: pointer;
  font: inherit;
}
.bili-mini-modal-button:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
}
.bili-mini-refresh {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #5c636b);
  cursor: pointer;
}
.bili-mini-refresh:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--dsw-alias-label-primary, #1f2329);
}
.bili-mini-refresh:disabled {
  cursor: default;
  opacity: 0.5;
}
.bili-mini-refresh:focus-visible,
.bili-mini-card:focus-visible,
.bili-mini-retry:focus-visible,
.bili-mini-player-close:focus-visible,
.bili-mini-sync:focus-visible,
.bili-mini-quality:focus-visible,
.bili-mini-player-action:focus-visible,
.bili-mini-player-link:focus-visible,
.bili-mini-login:focus-visible,
.bili-mini-logout:focus-visible,
.bili-mini-tab:focus-visible,
.bili-mini-modal-button:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #00aeec);
  outline-offset: 2px;
}
.bili-mini-player {
  margin: 0 0 18px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.03));
}
.bili-mini-player-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 2px 2px 10px;
}
.bili-mini-player-title {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bili-mini-player-head-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}
.bili-mini-sync {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}
.bili-mini-sync:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--dsw-alias-label-primary, #1f2329);
}
.bili-mini-sync.is-on {
  color: var(--dsw-alias-label-secondary, #5c636b);
}
.bili-mini-sync-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary, #8a9099);
}
.bili-mini-sync.is-on .bili-mini-sync-dot {
  background: var(--dsw-alias-brand-primary, #00aeec);
}
.bili-mini-quality {
  flex: none;
  max-width: 96px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #5c636b);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}
.bili-mini-quality:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--dsw-alias-label-primary, #1f2329);
}
.bili-mini-quality:disabled {
  cursor: default;
  opacity: 0.55;
}
.bili-mini-quality option {
  background: #fff;
  color: #1f2329;
}
.bili-mini-quality option:disabled {
  color: #9aa0a6;
}
.bili-mini-player-close {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #5c636b);
  cursor: pointer;
}
.bili-mini-player-close:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--dsw-alias-label-primary, #1f2329);
}
.bili-mini-player-stage-wrap {
  position: relative;
  overflow: hidden;
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  background: #000;
}
.bili-mini-player-stage {
  width: 100%;
  height: 100%;
}
.bili-mini-player-stage .art-video-player {
  width: 100% !important;
  height: 100% !important;
}
.bili-mini-player-overlay {
  position: absolute;
  inset: 0;
  z-index: 1000;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  overflow: auto;
  padding: 18px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  text-align: center;
}
.bili-mini-player-overlay-soft {
  background: rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
.bili-mini-player-overlay-title {
  font-size: 14px;
  font-weight: 600;
}
.bili-mini-player-overlay-body {
  max-width: 100%;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.5;
  opacity: 0.82;
}
.bili-mini-player-spinner {
  width: 22px;
  height: 22px;
  border: 2px solid rgba(255, 255, 255, 0.28);
  border-top-color: #fff;
  border-radius: 50%;
}
.bili-mini-player-action {
  margin-top: 4px;
  padding: 6px 14px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  cursor: pointer;
  font: inherit;
}
.bili-mini-player-action:hover {
  background: rgba(255, 255, 255, 0.22);
}
.bili-mini-player-link {
  color: #fff;
  font-size: 12px;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.bili-mini-player-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 2px 0;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 12px;
}
.bili-mini-player-meta .bili-mini-player-link {
  color: var(--dsw-alias-link, #00aeec);
}
.bili-mini-player-facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.bili-mini-player-chip {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-secondary, #5c636b);
  font-size: 11px;
}
.bili-mini-player-chip-warn {
  color: var(--dsw-alias-state-warn-label, #b26a00);
}
.bili-mini-player .apd-toggle {
  display: none !important;
}
.bili-mini-danmaku-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: inherit;
}
.bili-mini-danmaku-toggle[data-on="false"] {
  opacity: 0.45;
}
.bili-mini-danmaku-toggle[data-on="false"]::after {
  content: '';
  position: absolute;
  left: 4px;
  right: 4px;
  top: 50%;
  height: 1.5px;
  border-radius: 1px;
  background: currentColor;
  transform: rotate(-45deg);
}
.bili-mini-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(150px, 100%), 1fr));
  gap: 14px;
}
.bili-mini-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  padding: 6px;
  border-radius: 10px;
  color: inherit;
  text-decoration: none;
}
.bili-mini-card:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
}
.bili-mini-card-active {
  background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.06));
}
.bili-mini-card-active .bili-mini-cover {
  outline: 2px solid var(--dsw-alias-brand-primary, #00aeec);
  outline-offset: 1px;
}
.bili-mini-card-play {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.26);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.bili-mini-card:hover .bili-mini-card-play,
.bili-mini-card:focus-visible .bili-mini-card-play {
  opacity: 1;
}
.bili-mini-cover {
  position: relative;
  overflow: hidden;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.06));
}
.bili-mini-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.bili-mini-noimg {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 12px;
}
.bili-mini-duration {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 2;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.66);
  color: #fff;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 1.45;
}
.bili-mini-name {
  display: -webkit-box;
  overflow: hidden;
  min-height: 2.9em;
  font-size: 13px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.bili-mini-up {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 11px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bili-mini-skeleton .bili-mini-cover,
.bili-mini-skel-line {
  background: linear-gradient(
    90deg,
    var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.06)) 25%,
    var(--dsw-alias-bg-layer-3, rgba(0, 0, 0, 0.1)) 37%,
    var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.06)) 63%
  );
  background-size: 400% 100%;
  animation: bili-mini-shimmer 1.4s ease infinite;
}
.bili-mini-skeleton .bili-mini-cover {
  border-radius: 8px;
}
.bili-mini-skel-line {
  width: 100%;
  height: 10px;
  border-radius: 5px;
}
.bili-mini-skel-short {
  width: 52%;
}
.bili-mini-state {
  padding: 28px 4px;
  text-align: center;
}
.bili-mini-state-title {
  font-size: 14px;
  font-weight: 600;
}
.bili-mini-state-body {
  margin-top: 6px;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.bili-mini-retry {
  margin-top: 14px;
  padding: 6px 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.03));
  color: var(--dsw-alias-label-primary, #1f2329);
  cursor: pointer;
  font: inherit;
}
.bili-mini-retry:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
.bili-mini-spin {
  animation: bili-mini-spin 0.8s linear infinite;
  transform-box: fill-box;
  transform-origin: center;
}
@keyframes bili-mini-shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}
@keyframes bili-mini-spin {
  to { transform: rotate(360deg); }
}
@media (max-width: 360px) {
  .bili-mini-root { padding: 16px 14px 24px; }
  .bili-mini-player { padding: 8px; }
  .bili-mini-player-meta { font-size: 11px; }
}
@media (prefers-reduced-motion: reduce) {
  .bili-mini-skeleton .bili-mini-cover,
  .bili-mini-skel-line,
  .bili-mini-spin {
    animation: none;
  }
  .bili-mini-card-play {
    transition: none;
  }
}
`;

    function registerUi(ctx) {
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          { name: 'main', key: PANEL_ID, locale: NS },
          BiliMiniPanel,
        ),
      );

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 60,
            locale: NS,
            label: () => t('panel'),
          },
          BiliMiniIcon,
        ),
      );
    }

    function apply(ctx) {
      const disposeLocale = ctx.locale.register(NS, DICTIONARY);
      t = ctx.locale.bind(NS);
      const ui = ctx.inject(['slots'], () => registerUi(ctx));

      return () => {
        ui?.dispose?.();
        disposeLocale?.();
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    };
  },
});
