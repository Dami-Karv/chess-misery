const path = require('node:path');

require('dotenv').config({ quiet: true });

const rootDir = path.resolve(__dirname, '..');

function intEnv(name, fallback, min = 1) {
  const value = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(value, min);
}

module.exports = {
  rootDir,
  discordToken: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID || null,
  pollSeconds: intEnv('POLL_SECONDS', 300, 30),
  analysisDepth: intEnv('ANALYSIS_DEPTH', 8, 1),
  blunderThresholdCp: intEnv('BLUNDER_THRESHOLD_CP', 200, 1),
  maxAnalyzedPlies: intEnv('MAX_ANALYZED_PLIES', 120, 2),
  healthServerEnabled: process.env.HEALTH_SERVER_ENABLED !== 'false',
  healthPort: intEnv('PORT', 3000, 1),
  userAgent:
    process.env.CHESS_COM_USER_AGENT ||
    'chessmisery/1.0 (Discord bot; set CHESS_COM_USER_AGENT in .env)',
  redisUrl: process.env.REDIS_URL || null,
  upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL || null,
  upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN || null,
  redisKey: process.env.REDIS_KEY || 'chessmisery:db',
  databasePath: process.env.DATABASE_PATH || path.join(rootDir, 'data', 'db.json'),
  stockfishPath:
    process.env.STOCKFISH_PATH ||
    path.join(rootDir, 'vendor', 'stockfish', 'stockfish-18-lite-single.js'),
};
