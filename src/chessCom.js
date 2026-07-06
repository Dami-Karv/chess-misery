const { normalizeChessUsername } = require('./utils');

const BASE_URL = 'https://api.chess.com/pub';
const LOSS_RESULTS = new Set([
  'checkmated',
  'timeout',
  'resigned',
  'lose',
  'abandoned',
  'kingofthehill',
  'threecheck',
  'bughousepartnerlose',
]);

async function chessComFetch(path, config, cacheEntry = null) {
  const headers = {
      'User-Agent': config.userAgent,
      Accept: 'application/json',
  };
  if (cacheEntry?.etag) headers['If-None-Match'] = cacheEntry.etag;
  if (cacheEntry?.lastModified) headers['If-Modified-Since'] = cacheEntry.lastModified;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 304) {
      return {
        notModified: true,
        data: null,
        cache: cacheEntry,
      };
    }
    if (response.status === 404) return null;
    if (response.status === 429) {
      throw new Error('Chess.com rate limit hit. Increase POLL_SECONDS.');
    }
    if (response.status >= 500 && attempt === 0) {
      await sleep(750);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Chess.com request failed: ${response.status} ${response.statusText}`);
    }

    return {
      notModified: false,
      data: await response.json(),
      cache: {
        etag: response.headers.get('etag') || null,
        lastModified: response.headers.get('last-modified') || null,
      },
    };
  }

}

async function getPlayer(username, config) {
  const response = await chessComFetch(
    `/player/${encodeURIComponent(normalizeChessUsername(username))}`,
    config,
  );
  return response?.data || null;
}

async function getRecentGames(username, config, now = new Date(), options = {}) {
  const archiveCache = options.archiveCache || null;
  const months = recentMonths(now, options.includePrevious !== false);
  const allGames = [];
  let archiveDirty = false;

  for (const { year, month } of months) {
    const key = `${year}-${month}`;
    const response = await chessComFetch(
      `/player/${encodeURIComponent(normalizeChessUsername(username))}/games/${year}/${month}`,
      config,
      archiveCache?.[key],
    );
    if (!response) continue;
    if (archiveCache && response.cache && !sameCacheEntry(archiveCache[key], response.cache)) {
      archiveCache[key] = response.cache;
      archiveDirty = true;
    }
    if (response.notModified) continue;
    if (response.data?.games) allGames.push(...response.data.games);
  }

  return {
    games: allGames
    .filter((game) => game.url && game.end_time)
      .sort((a, b) => a.end_time - b.end_time || a.url.localeCompare(b.url)),
    archiveDirty,
  };
}

function sameCacheEntry(left, right) {
  return left?.etag === right?.etag && left?.lastModified === right?.lastModified;
}

function recentMonths(now, includePrevious) {
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const months = includePrevious ? [previous, current] : [current];
  return months.map((date) => ({
    year: date.getUTCFullYear(),
    month: String(date.getUTCMonth() + 1).padStart(2, '0'),
  }));
}

function getPlayerSide(game, username) {
  const normalized = normalizeChessUsername(username);
  if (normalizeChessUsername(game.white?.username) === normalized) return 'white';
  if (normalizeChessUsername(game.black?.username) === normalized) return 'black';
  return null;
}

function getGameSummary(game, username) {
  const side = getPlayerSide(game, username);
  if (!side) return null;

  const player = game[side];
  const opponentSide = side === 'white' ? 'black' : 'white';
  const opponent = game[opponentSide];
  const bucket = [
    game.rules || 'chess',
    game.time_class || 'unknown',
    game.rated ? 'rated' : 'unrated',
  ].join(':');

  return {
    side,
    color: side === 'white' ? 'w' : 'b',
    player,
    opponent,
    bucket,
    rating: Number.isFinite(player?.rating) ? player.rating : null,
    opponentRating: Number.isFinite(opponent?.rating) ? opponent.rating : null,
    result: player?.result || 'unknown',
    isLoss: LOSS_RESULTS.has(player?.result),
    timeClass: game.time_class || 'unknown',
    rules: game.rules || 'chess',
    rated: Boolean(game.rated),
    timeControl: game.time_control || null,
    endTime: game.end_time,
    url: game.url,
  };
}

function isNewerThanState(game, state) {
  if (!state?.lastEndTime) return false;
  if (game.end_time > state.lastEndTime) return true;
  return game.end_time === state.lastEndTime && !getSeenAtLastEnd(state).includes(gameId(game.url));
}

function seedStateFromGames(state, games, username) {
  state.ratings ||= {};
  for (const game of games) {
    const summary = getGameSummary(game, username);
    if (summary && summary.rating !== null) state.ratings[summary.bucket] = summary.rating;
  }

  const latest = games.at(-1);
  if (latest) {
    state.lastEndTime = latest.end_time;
    state.seenAtLastEnd = games
      .filter((game) => game.end_time === latest.end_time)
      .map((game) => gameId(game.url));
  } else {
    state.seenAtLastEnd = [];
  }
  delete state.lastGameUrl;
  delete state.seenGameUrls;
}

function getSeenAtLastEnd(state) {
  if (Array.isArray(state.seenAtLastEnd)) return state.seenAtLastEnd;
  if (!Array.isArray(state.seenGameUrls)) return [];
  return state.seenGameUrls.map(gameId);
}

function gameId(url) {
  const match = String(url || '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function shouldIncludePreviousMonth(now = new Date()) {
  return now.getUTCDate() <= 2;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  getPlayer,
  getRecentGames,
  getGameSummary,
  isNewerThanState,
  seedStateFromGames,
  shouldIncludePreviousMonth,
  gameId,
};
