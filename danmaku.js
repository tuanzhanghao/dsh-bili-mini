/**
 * Bilibili XML danmaku (list.so) for one cid.
 *
 * The endpoint returns at most 1000 entries (`<maxlimit>1000</maxlimit>`), and
 * each entry looks like:
 *
 *   <d p="time,mode,fontsize,color,timestamp,pool,uid,rowid,weight">text</d>
 *
 * We map Bilibili modes to the ArtPlayer danmaku plugin's modes:
 *   1/2/3 -> 0 (scroll), 5 -> 1 (top), 4 -> 2 (bottom).
 * Modes 6-8 (reverse/special/code) are not rendered by the plugin and are
 * dropped. The XML only carries a hashed UID, not a nickname, so `author` is
 * that UID.
 */

import { BILI_UA } from './bili.js';

const ENDPOINT = 'https://api.bilibili.com/x/v1/dm/list.so';
const HEADERS = {
  'User-Agent': BILI_UA,
  Referer: 'https://www.bilibili.com/',
  Accept: '*/*',
};

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Fetch and parse one cid's XML danmaku.
 *
 * @param {number} cid
 * @param {{ timeoutMs?: number, limit?: number }} [options]
 * @returns {Promise<Array<{
 *   id: string, time: number, mode: number, biliMode: number,
 *   color: string, author: string, text: string,
 * }>>}
 */
export async function fetchDanmaku(cid, { timeoutMs = 9000, limit = 1000 } = {}) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('oid', String(cid));

  let response;
  try {
    response = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(clamp(timeoutMs, 1000, 30000)),
    });
  } catch (error) {
    throw new Error(`无法连接 B 站弹幕接口：${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`B 站弹幕接口返回 HTTP ${response.status}`);
  }

  const xml = await response.text();
  if (!xml.includes('<i>') && !xml.includes('<d')) {
    throw new Error('B 站弹幕接口返回了非 XML 内容');
  }

  return parseDanmakuXml(xml, { limit });
}

/**
 * Parse Bilibili's list.so XML into ArtPlayer danmaku entries.
 *
 * @param {string} xml
 * @param {{ limit?: number }} [options]
 */
export function parseDanmakuXml(xml, { limit = 1000 } = {}) {
  if (typeof xml !== 'string' || xml.length === 0) return [];

  const max = clamp(limit, 1, 1000);
  const items = [];
  const rows = /<d\b([^>]*)>([\s\S]*?)<\/d>/g;
  let row;

  while ((row = rows.exec(xml)) !== null && items.length < max) {
    const p = /\bp="([^"]*)"/.exec(row[1])?.[1];
    if (!p) continue;

    const parts = p.split(',');
    if (parts.length < 7) continue;

    const time = Number(parts[0]);
    const biliMode = Number(parts[1]) || 1;
    const text = decodeXmlEntities(row[2]).trim();

    if (!Number.isFinite(time) || time < 0 || !text) continue;
    if (![1, 2, 3, 4, 5].includes(biliMode)) continue;

    items.push({
      id: parts[7] || `dm-${items.length}`,
      time: Math.round(time * 1000) / 1000,
      mode: mapMode(biliMode),
      biliMode,
      color: toHex(parts[3]),
      author: parts[6] || '',
      text,
    });
  }

  items.sort((a, b) => a.time - b.time);
  return items;
}

function mapMode(biliMode) {
  if (biliMode === 4) return 2;
  if (biliMode === 5) return 1;
  return 0;
}

function toHex(value) {
  const n = Number(value);
  const color = Number.isFinite(n)
    ? Math.min(Math.max(Math.trunc(n), 0), 0xffffff)
    : 0xffffff;
  return `#${color.toString(16).padStart(6, '0').toUpperCase()}`;
}

function decodeXmlEntities(value) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith('#')) {
      const hex = entity[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(Math.trunc(n), min), max);
}
