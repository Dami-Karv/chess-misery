const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeChessUsername } = require('./utils');

const DEFAULT_FILTERS = Object.freeze({
  timeClasses: [],
  ratedOnly: false,
  standardOnly: false,
  minEloLoss: 0,
  minBlunders: 0,
  requireGameEndingBlunder: false,
});

function emptyDb() {
  return { guilds: {} };
}

class BaseStore {
  constructor() {
    this.db = emptyDb();
  }

  guild(guildId) {
    if (!this.db.guilds[guildId]) {
      this.db.guilds[guildId] = {
        reportChannelId: null,
        filters: { ...DEFAULT_FILTERS },
        links: {},
        chessUsers: {},
      };
    }

    const guild = this.db.guilds[guildId];
    guild.filters ||= { ...DEFAULT_FILTERS };
    guild.links ||= {};
    guild.chessUsers ||= {};
    return guild;
  }

  getGuild(guildId) {
    const guild = this.db.guilds[guildId] || null;
    if (!guild) return null;
    guild.filters ||= { ...DEFAULT_FILTERS };
    guild.links ||= {};
    guild.chessUsers ||= {};
    return guild;
  }

  setReportChannel(guildId, channelId) {
    this.guild(guildId).reportChannelId = channelId;
  }

  linkUser(guildId, discordUserId, chessUsername, displayUsername) {
    const normalized = normalizeChessUsername(chessUsername);
    const link = { chessUsername: normalized };
    if (displayUsername && displayUsername !== normalized) {
      link.displayUsername = displayUsername;
    }
    const guild = this.guild(guildId);
    guild.links[discordUserId] = link;
    guild.chessUsers[normalized] ||= {
      lastEndTime: 0,
      ratings: {},
      seenAtLastEnd: [],
      archiveCache: {},
    };
    return guild.chessUsers[normalized];
  }

  unlinkUser(guildId, discordUserId) {
    const guild = this.guild(guildId);
    const link = guild.links[discordUserId] || null;
    delete guild.links[discordUserId];
    return link;
  }

  linksForChessUser(guildId, chessUsername) {
    const normalized = normalizeChessUsername(chessUsername);
    const guild = this.getGuild(guildId);
    if (!guild) return [];
    return Object.entries(guild.links).filter(
      ([, link]) => link.chessUsername === normalized,
    );
  }

  setFilters(guildId, filters) {
    const guild = this.guild(guildId);
    guild.filters = { ...DEFAULT_FILTERS, ...guild.filters, ...filters };
    return guild.filters;
  }

  setAnalysisDepth(guildId, depth) {
    const guild = this.guild(guildId);
    guild.analysisDepth = depth;
    return depth;
  }
}

class JsonStore extends BaseStore {
  constructor(filePath) {
    super();
    this.filePath = filePath;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.db = parseDb(raw);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.db = emptyDb();
      await this.save();
    }
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(this.db));
    await fs.rename(tempPath, this.filePath);
  }
}

class UpstashRestStore extends BaseStore {
  constructor(restUrl, token, key) {
    super();
    this.restUrl = restUrl.replace(/\/$/, '');
    this.token = token;
    this.key = key;
  }

  async load() {
    const raw = await this.command('GET', this.key);
    this.db = raw ? parseDb(raw) : emptyDb();
    if (!raw) await this.save();
  }

  async save() {
    await this.command('SET', this.key, JSON.stringify(this.db));
  }

  async command(...command) {
    const response = await fetch(`${this.restUrl}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([command]),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Upstash request failed: ${response.status} ${response.statusText}`);
    }

    const [result] = await response.json();
    if (result?.error) throw new Error(`Upstash command failed: ${result.error}`);
    return result?.result ?? null;
  }
}

function createStore(config) {
  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    return new UpstashRestStore(
      config.upstashRedisRestUrl,
      config.upstashRedisRestToken,
      config.redisKey,
    );
  }
  if (config.redisUrl) {
    throw new Error(
      'REDIS_URL is no longer used. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN instead.',
    );
  }
  return new JsonStore(config.databasePath);
}

function parseDb(raw) {
  const db = JSON.parse(raw);
  if (!db.guilds) db.guilds = {};
  migrateDb(db);
  return db;
}

function migrateDb(db) {
  for (const guild of Object.values(db.guilds)) {
    guild.links ||= {};
    guild.chessUsers ||= {};
    guild.filters = { ...DEFAULT_FILTERS, ...(guild.filters || {}) };
    for (const link of Object.values(guild.links)) {
      if (link.displayUsername === link.chessUsername) delete link.displayUsername;
    }
    for (const state of Object.values(guild.chessUsers)) {
      if (!Array.isArray(state.seenAtLastEnd)) {
        state.seenAtLastEnd = Array.isArray(state.seenGameUrls)
          ? state.seenGameUrls.map(gameId)
          : [];
      }
      delete state.displayUsername;
      delete state.lastGameUrl;
      delete state.seenGameUrls;
    }
  }
}

function gameId(url) {
  const match = String(url || '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

module.exports = { JsonStore, UpstashRestStore, createStore };
