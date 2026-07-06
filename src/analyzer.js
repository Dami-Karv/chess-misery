const { Chess } = require('chess.js');
const { StockfishEngine } = require('./stockfish');

let sharedEngine = null;

async function analyzeBlunders(pgn, playerColor, config, engine = getSharedEngine(config)) {
  if (!pgn || !['w', 'b'].includes(playerColor)) {
    return { available: false, reason: 'No PGN available for analysis.' };
  }

  const chess = new Chess();
  try {
    chess.loadPgn(pgn, { strict: false });
  } catch (error) {
    return { available: false, reason: `PGN could not be parsed: ${error.message}` };
  }

  const moves = chess.history({ verbose: true }).slice(0, config.maxAnalyzedPlies);

  try {
    await engine.start();
    const blunders = [];

    for (const move of moves) {
      if (move.color !== playerColor) continue;

      const beforeEval = await engine.evaluateFen(move.before);
      const afterEval = await engine.evaluateFen(move.after);
      const beforePlayer = playerColor === 'w' ? beforeEval.cpForWhite : -beforeEval.cpForWhite;
      const afterPlayer = playerColor === 'w' ? afterEval.cpForWhite : -afterEval.cpForWhite;
      const drop = beforePlayer - afterPlayer;

      if (drop >= config.blunderThresholdCp) {
        blunders.push({
          moveNumber: formatMoveNumber(move),
          san: move.san,
          dropCp: Math.round(drop),
          beforeCp: Math.round(beforePlayer),
          afterCp: Math.round(afterPlayer),
          beforeFen: move.before,
          afterFen: move.after,
          color: move.color,
          from: move.from,
          to: move.to,
          bestMove: beforeEval.bestMove,
          bestMoveSan: bestMoveSan(move.before, beforeEval.bestMove),
        });
      }
    }

    return { available: true, blunders };
  } catch (error) {
    if (engine === sharedEngine) {
      sharedEngine = null;
    }
    return { available: false, reason: error.message };
  }
}

function getSharedEngine(config) {
  sharedEngine ||= new StockfishEngine(config);
  return sharedEngine;
}

async function closeSharedEngine() {
  if (!sharedEngine) return;
  await sharedEngine.close();
  sharedEngine = null;
}

function formatMoveNumber(move) {
  const fullMove = move.before.split(' ')[5];
  return move.color === 'b' ? `${fullMove}...` : `${fullMove}.`;
}

function bestMoveSan(fen, lan) {
  if (!lan) return null;
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: lan.slice(0, 2),
      to: lan.slice(2, 4),
      promotion: lan[4],
    });
    return move?.san || lan;
  } catch {
    return lan;
  }
}

function formatEval(cp) {
  if (Math.abs(cp) > 90_000) return cp > 0 ? 'mate soon' : 'getting mated';
  const pawns = cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

function formatBlunders(analysis) {
  if (!analysis.available) return `Unavailable (${analysis.reason})`;
  if (analysis.blunders.length === 0) return '0 found by local engine';

  const details = [...analysis.blunders]
    .sort((a, b) => b.dropCp - a.dropCp)
    .slice(0, 3)
    .map(
      (item) =>
        `${severityLabel(item)}: ${item.moveNumber} ${item.san}\n${formatDrop(item)} | ${formatEval(item.beforeCp)} -> ${formatEval(item.afterCp)}`,
    );
  const suffix =
    analysis.blunders.length > details.length
      ? `\n...and ${analysis.blunders.length - details.length} more`
      : '';
  return `${analysis.blunders.length} found\n${details.join('\n')}${suffix}`;
}

function severityLabel(item) {
  if (Math.abs(item.afterCp) > 90_000 || item.dropCp > 90_000) return 'Game-ending';
  if (item.dropCp >= 1_000) return 'Collapse';
  if (item.dropCp >= 500) return 'Disaster';
  return 'Major blunder';
}

function formatDrop(item) {
  if (item.dropCp > 90_000) return 'lost forced mate';
  return `dropped ${(item.dropCp / 100).toFixed(1)} pawns`;
}

module.exports = { analyzeBlunders, formatBlunders, closeSharedEngine, formatEval, severityLabel, formatDrop };
