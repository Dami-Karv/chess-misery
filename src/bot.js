const {
  AttachmentBuilder,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const {
  analyzeBlunders,
  closeSharedEngine,
  formatBlunders,
  formatEval,
  severityLabel,
} = require('./analyzer');
const { renderBlunderSheet } = require('./boardImage');
const {
  gameId,
  getGameSummary,
  getPlayer,
  getRecentGames,
  isNewerThanState,
  seedStateFromGames,
  shouldIncludePreviousMonth,
} = require('./chessCom');
const config = require('./config');
const { createStore } = require('./store');
const { normalizeChessUsername } = require('./utils');

const store = createStore(config);
const missingChannelWarnings = new Set();
let pollInProgress = null;

const COMMAND_HANDLERS = new Map([
  ['set-loss-channel', handleSetLossChannel],
  ['link-chess', handleLinkChess],
  ['unlink-chess', handleUnlinkChess],
  ['chess-links', handleChessLinks],
  ['set-loss-filters', handleSetLossFilters],
  ['loss-filters', handleLossFilters],
  ['check-chess-losses', handleCheckChessLosses],
  ['set-analysis-depth', handleSetAnalysisDepth],
]);

function createClient() {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

async function start() {
  if (!config.discordToken) throw new Error('DISCORD_TOKEN is missing.');

  await store.load();
  const client = createClient();

  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await pollAllGuilds(client);
    setInterval(() => {
      pollAllGuilds(client).catch((error) => console.error('Poll failed:', error));
    }, config.pollSeconds * 1000);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || !interaction.guildId) return;

    try {
      const handler = COMMAND_HANDLERS.get(interaction.commandName);
      if (handler) await handler(interaction);
    } catch (error) {
      console.error(error);
      await safeReply(interaction, `Error: ${error.message}`);
    }
  });

  await client.login(config.discordToken);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await closeSharedEngine();
    process.exit(0);
  });
}

async function handleSetLossChannel(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  store.setReportChannel(interaction.guildId, channel.id);
  await store.save();
  await interaction.reply({
    content: `Loss reports will be posted in ${channel}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleLinkChess(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const target = interaction.options.getUser('user') || interaction.user;
  if (target.id !== interaction.user.id && !canManageGuild(interaction)) {
    throw new Error('Only members with Manage Server can link someone else.');
  }

  const requestedUsername = interaction.options.getString('username', true);
  const profile = await getPlayer(requestedUsername, config);
  if (!profile?.username) {
    throw new Error(`Chess.com user "${requestedUsername}" was not found.`);
  }

  const state = store.linkUser(
    interaction.guildId,
    target.id,
    profile.username,
    profile.username,
  );

  state.archiveCache ||= {};
  const { games } = await getRecentGames(profile.username, config, new Date(), {
    archiveCache: state.archiveCache,
    includePrevious: true,
  });
  seedStateFromGames(state, games, profile.username);
  await store.save();

  await interaction.editReply(
    `${target} is linked to Chess.com user **${profile.username}**. I seeded their current history, so only future losses will be posted.`,
  );
}

async function handleUnlinkChess(interaction) {
  const target = interaction.options.getUser('user') || interaction.user;
  if (target.id !== interaction.user.id && !canManageGuild(interaction)) {
    throw new Error('Only members with Manage Server can unlink someone else.');
  }

  const link = store.unlinkUser(interaction.guildId, target.id);
  await store.save();

  await interaction.reply({
    content: link
      ? `${target} is no longer linked to **${displayChessUsername(link)}**.`
      : `${target} did not have a Chess.com link.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleChessLinks(interaction) {
  const guild = store.getGuild(interaction.guildId);
  const rows = Object.entries(guild?.links || {}).map(
    ([discordUserId, link]) => `<@${discordUserId}> -> **${displayChessUsername(link)}**`,
  );

  await interaction.reply({
    content: rows.length ? rows.join('\n') : 'No Chess.com users are linked yet.',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSetLossFilters(interaction) {
  const timeClassesInput = interaction.options.getString('time_classes');
  const ratedOnly = interaction.options.getBoolean('rated_only');
  const standardOnly = interaction.options.getBoolean('standard_only');
  const minEloLoss = interaction.options.getInteger('min_elo_loss');
  const minBlunders = interaction.options.getInteger('min_blunders');
  const gameEndingOnly = interaction.options.getBoolean('game_ending_only');

  const updates = {};
  if (timeClassesInput !== null) updates.timeClasses = parseTimeClasses(timeClassesInput);
  if (ratedOnly !== null) updates.ratedOnly = ratedOnly;
  if (standardOnly !== null) updates.standardOnly = standardOnly;
  if (minEloLoss !== null) updates.minEloLoss = minEloLoss;
  if (minBlunders !== null) updates.minBlunders = minBlunders;
  if (gameEndingOnly !== null) updates.requireGameEndingBlunder = gameEndingOnly;

  if (Object.keys(updates).length === 0) {
    throw new Error('Set at least one filter option.');
  }

  const filters = store.setFilters(interaction.guildId, updates);
  await store.save();
  await interaction.reply({
    content: `Loss filters updated:\n${formatFilters(filters)}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleLossFilters(interaction) {
  const guild = store.getGuild(interaction.guildId);
  await interaction.reply({
    content: `Current loss filters:\n${formatFilters(guild?.filters)}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleCheckChessLosses(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await pollAllGuilds(interaction.client);
  await interaction.editReply('Checked Chess.com for new losses.');
}

async function handleSetAnalysisDepth(interaction) {
  const depth = interaction.options.getInteger('depth', true);
  store.setAnalysisDepth(interaction.guildId, depth);
  await store.save();
  await interaction.reply({
    content: `Stockfish analysis depth set to **${depth}**.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function pollAllGuilds(client) {
  if (pollInProgress) return pollInProgress;
  pollInProgress = pollAllGuildsLocked(client).finally(() => {
    pollInProgress = null;
  });
  return pollInProgress;
}

async function pollAllGuildsLocked(client) {
  const gameCache = new Map();
  let dirty = false;

  for (const guildId of Object.keys(store.db.guilds)) {
    const guild = store.getGuild(guildId);
    if (!guild.reportChannelId) continue;

    const channel = await fetchChannel(client, guildId, guild.reportChannelId);
    if (!channel?.isTextBased()) continue;

    const linkedUsernames = [...new Set(Object.values(guild.links).map((link) => link.chessUsername))];
    for (const chessUsername of linkedUsernames) {
      dirty = (await processChessUserForGuild(channel, guildId, chessUsername, gameCache)) || dirty;
    }
  }

  if (dirty) await store.save();
}

async function processChessUserForGuild(channel, guildId, chessUsername, gameCache) {
  const guild = store.guild(guildId);
  const state = (guild.chessUsers[chessUsername] ||= {
    lastEndTime: 0,
    ratings: {},
    seenAtLastEnd: [],
    archiveCache: {},
  });
  state.archiveCache ||= {};

  const cachedGames = await getCachedGames(chessUsername, state, gameCache);
  const games = cachedGames.games;
  if (!state.lastEndTime) {
    seedStateFromGames(state, games, chessUsername);
    return true;
  }

  const newGames = games.filter((game) => isNewerThanState(game, state));
  let dirty = cachedGames.archiveDirty;
  for (const game of newGames) {
    const summary = getGameSummary(game, chessUsername);
    if (!summary) continue;

    const previousRating = state.ratings?.[summary.bucket] ?? null;
    const eloDelta =
      previousRating !== null && summary.rating !== null ? summary.rating - previousRating : null;

    if (!summary.isLoss) {
      markGameProcessed(state, game, summary);
      dirty = true;
      continue;
    }

    if (!matchesBasicFilters(summary, guild.filters, eloDelta)) {
      markGameProcessed(state, game, summary);
      dirty = true;
      continue;
    }

    const analysis = prepareAnalysis(await analyzeGameForReport(game, summary, guildId));
    if (!matchesAnalysisFilters(analysis, guild.filters)) {
      markGameProcessed(state, game, summary);
      dirty = true;
      continue;
    }

    const links = store.linksForChessUser(guildId, chessUsername);
    let posted = false;
    for (const [discordUserId] of links) {
      try {
        await postLossReport(channel, discordUserId, game, summary, eloDelta, analysis);
        posted = true;
      } catch (error) {
        console.error(`Could not post loss report for ${chessUsername}:`, error);
      }
    }

    if (posted || links.length === 0) {
      markGameProcessed(state, game, summary);
      dirty = true;
    }
  }

  return dirty;
}

async function getCachedGames(chessUsername, state, gameCache) {
  const normalized = normalizeChessUsername(chessUsername);
  if (!gameCache.has(normalized)) {
    gameCache.set(
      normalized,
      await getRecentGames(normalized, config, new Date(), {
        archiveCache: state.archiveCache,
        includePrevious: !state.lastEndTime || shouldIncludePreviousMonth(),
      }),
    );
  }
  return gameCache.get(normalized);
}

function markGameProcessed(state, game, summary) {
  state.ratings ||= {};
  if (summary.rating !== null) state.ratings[summary.bucket] = summary.rating;
  recordSeenGame(state, game);
}

function recordSeenGame(state, game) {
  const id = gameId(game.url);
  if (game.end_time > (state.lastEndTime || 0)) {
    state.lastEndTime = game.end_time;
    state.seenAtLastEnd = [id];
    return;
  }

  state.seenAtLastEnd ||= [];
  if (!state.seenAtLastEnd.includes(id)) state.seenAtLastEnd.push(id);
}

function displayChessUsername(link) {
  return link.displayUsername || link.chessUsername;
}

function parseTimeClasses(input) {
  const normalized = input
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (normalized.length === 0 || normalized.includes('all') || normalized.includes('*')) {
    return [];
  }

  const allowed = new Set(['bullet', 'blitz', 'rapid', 'daily']);
  const invalid = normalized.filter((item) => !allowed.has(item));
  if (invalid.length > 0) {
    throw new Error(`Invalid time class: ${invalid.join(', ')}. Use bullet, blitz, rapid, daily, or all.`);
  }

  return [...new Set(normalized)];
}

function matchesBasicFilters(summary, filters = {}, eloDelta = null) {
  const timeClasses = filters.timeClasses || [];
  if (timeClasses.length > 0 && !timeClasses.includes(summary.timeClass)) return false;
  if (filters.ratedOnly && !summary.rated) return false;
  if (filters.standardOnly && summary.rules !== 'chess') return false;
  if (filters.minEloLoss > 0) {
    if (eloDelta === null || eloDelta >= 0 || Math.abs(eloDelta) < filters.minEloLoss) return false;
  }
  return true;
}

function matchesAnalysisFilters(analysis, filters = {}) {
  if (filters.minBlunders > 0) {
    if (!analysis.available || analysis.blunders.length < filters.minBlunders) return false;
  }
  if (filters.requireGameEndingBlunder) {
    if (!analysis.available || !analysis.blunders.some(isGameEndingBlunder)) return false;
  }
  return true;
}

function isGameEndingBlunder(blunder) {
  return Math.abs(blunder.afterCp) > 90_000 || blunder.dropCp > 90_000;
}

function formatFilters(filters = {}) {
  const timeClasses = filters.timeClasses?.length ? filters.timeClasses.join(', ') : 'all';
  return [
    `Time classes: ${timeClasses}`,
    `Rated only: ${filters.ratedOnly ? 'yes' : 'no'}`,
    `Standard chess only: ${filters.standardOnly ? 'yes' : 'no'}`,
    `Minimum Elo loss: ${filters.minEloLoss || 0}`,
    `Minimum blunders: ${filters.minBlunders || 0}`,
    `Game-ending blunder only: ${filters.requireGameEndingBlunder ? 'yes' : 'no'}`,
  ].join('\n');
}

async function analyzeGameForReport(game, summary, guildId) {
  const canAnalyze =
    summary.rules === 'chess' && typeof game.pgn === 'string' && game.pgn.trim().length > 0;
  if (!canAnalyze) {
    return { available: false, reason: `Analysis only supports standard chess PGNs. Rules: ${summary.rules}` };
  }
  const guild = store.getGuild(guildId);
  const analysisConfig = guild?.analysisDepth
    ? { ...config, analysisDepth: guild.analysisDepth }
    : config;
  return analyzeBlunders(game.pgn, summary.color, analysisConfig);
}

function prepareAnalysis(analysis) {
  if (!analysis.available || !Array.isArray(analysis.blunders)) return analysis;
  analysis.blunders = chronologicalBlunders(analysis.blunders);
  analysis.worstBlunder = analysis.blunders.reduce(
    (worst, item) => (!worst || item.dropCp > worst.dropCp ? item : worst),
    null,
  );
  return analysis;
}

async function postLossReport(channel, discordUserId, game, summary, eloDelta, analysis) {
  const blunderSheet = await buildBlunderSheet(analysis);
  const attachments = blunderSheet ? [blunderSheet] : [];

  const opponentName = summary.opponent?.username || 'unknown opponent';
  const embed = new EmbedBuilder()
    .setColor(0xb91c1c)
    .setTitle(`${summary.player.username} lost to ${opponentName}`)
    .setURL(summary.url)
    .setDescription(`<@${discordUserId}> lost a ${summary.rated ? 'rated' : 'unrated'} ${summary.timeClass} game.`)
    .addFields(
      {
        name: 'Opponent',
        value: `${opponentName}${summary.opponentRating ? ` (${summary.opponentRating})` : ''}`,
        inline: true,
      },
      {
        name: 'Result',
        value: summary.result,
        inline: true,
      },
      {
        name: 'Elo change',
        value: formatEloDelta(eloDelta),
        inline: true,
      },
      {
        name: 'New rating',
        value: summary.rating === null ? 'Unknown' : String(summary.rating),
        inline: true,
      },
      {
        name: 'Duration',
        value: formatTimeControl(summary.timeControl),
        inline: true,
      },
      {
        name: 'Game link',
        value: `[Open on Chess.com](${summary.url})`,
        inline: true,
      },
      {
        name: 'Mistake report',
        value: truncate(formatMistakeSummary(analysis), 1024),
      },
    )
    .setTimestamp(new Date(summary.endTime * 1000));

  if (blunderSheet) embed.setImage(`attachment://${blunderSheet.name}`);

  await channel.send({
    embeds: [embed],
    files: attachments,
  });
}

async function buildBlunderSheet(analysis) {
  if (!analysis.available || analysis.blunders.length === 0) return null;

  const selectedBlunders = analysis.blunders.slice(0, 4);
  const image = await renderBlunderSheet(selectedBlunders);
  return new AttachmentBuilder(image, {
    name: 'blunders.png',
    description: 'Blunders with played and preferred arrows',
  });
}

function formatMistakeSummary(analysis) {
  if (!analysis.available) return formatBlunders(analysis);
  if (analysis.blunders.length === 0) return 'No major blunders found by local engine.';

  const counts = analysis.blunders.reduce(
    (acc, item) => {
      acc[severityLabel(item)] = (acc[severityLabel(item)] || 0) + 1;
      return acc;
    },
    {},
  );
  const worst = analysis.worstBlunder || analysis.blunders[0];
  const listed = analysis.blunders.slice(0, 4);
  const countsText = Object.entries(counts)
    .map(([label, count]) => `${label}: ${count}`)
    .join('\n');

  return [
    `${analysis.blunders.length} major blunder${analysis.blunders.length === 1 ? '' : 's'} found.`,
    countsText,
    `Shown: ${listed.map((item) => `${item.moveNumber} ${item.san}`).join(', ')}`,
    `Worst: ${worst.moveNumber} ${worst.san}`,
    `Best was: **${worst.bestMoveSan || worst.bestMove || 'unknown'}**`,
    `Eval: ${formatEval(worst.beforeCp)} -> ${formatEval(worst.afterCp)}`,
    'Image: red arrow = played, green arrow = engine preferred.',
  ].join('\n');
}

function formatTimeControl(timeControl) {
  if (!timeControl) return 'Unknown';
  const [baseRaw, incrementRaw] = String(timeControl).split('+');
  const base = Number.parseInt(baseRaw, 10);
  const increment = Number.parseInt(incrementRaw || '0', 10);
  if (!Number.isFinite(base)) return timeControl;
  return `${formatClock(base)}${increment ? ` + ${increment}s` : ''}`;
}

function formatClock(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function chronologicalBlunders(blunders) {
  return [...blunders].sort((a, b) => moveSortValue(a) - moveSortValue(b));
}

function moveSortValue(blunder) {
  const match = String(blunder.moveNumber || '').match(/\d+/);
  const moveNumber = match ? Number(match[0]) : 0;
  return moveNumber * 2 + (String(blunder.moveNumber).includes('...') ? 1 : 0);
}

function formatEloDelta(delta) {
  if (delta === null) return 'Unknown until another game in this category is seen';
  return delta > 0 ? `+${delta}` : String(delta);
}

function truncate(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function canManageGuild(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

async function fetchChannel(client, guildId, channelId) {
  try {
    return await client.channels.fetch(channelId);
  } catch (error) {
    const warningKey = `${guildId}:${channelId}`;
    if (!missingChannelWarnings.has(warningKey)) {
      missingChannelWarnings.add(warningKey);
      console.error(`Could not fetch report channel ${channelId} for guild ${guildId}: ${error.message}`);
    }
    return null;
  }
}

async function safeReply(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply(payload);
  }
}

module.exports = { start, pollAllGuilds };
