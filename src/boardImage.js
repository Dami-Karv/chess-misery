const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');

const PIECES = {
  K: 'wK',
  Q: 'wQ',
  R: 'wR',
  B: 'wB',
  N: 'wN',
  P: 'wP',
  k: 'bK',
  q: 'bQ',
  r: 'bR',
  b: 'bB',
  n: 'bN',
  p: 'bP',
};

let pieceImages = null;

async function renderBlunderSheet(blunders, options = {}) {
  const boardSize = options.boardSize || 360;
  const gap = options.gap || 16;
  const columns = Math.min(options.columns || 2, Math.max(1, blunders.length));
  const labelHeight = 104;
  const cellHeight = boardSize + labelHeight;
  const images = await Promise.all(
    blunders.map((blunder) =>
      sharp(Buffer.from(renderBoardSvg(blunder, boardSize))).png().toBuffer(),
    ),
  );
  const rows = Math.ceil(images.length / columns);
  const width = columns * boardSize + gap * (columns - 1);
  const height = rows * cellHeight + gap * (rows - 1);

  const composite = images.map((image, index) => ({
    input: image,
    left: (index % columns) * (boardSize + gap),
    top: Math.floor(index / columns) * (cellHeight + gap),
  }));

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#18181b',
    },
  })
    .composite(composite)
    .png()
    .toBuffer();
}

function renderBoardSvg(blunder, size) {
  const boardSize = size;
  const tile = boardSize / 8;
  const labelHeight = 104;
  const totalHeight = boardSize + labelHeight;
  const fen = blunder.beforeFen;
  const orientation = blunder.color === 'b' ? 'b' : 'w';
  const pieces = fenToPieces(fen, orientation);
  const playedArrow = moveArrow(blunder.from, blunder.to, orientation, tile, labelHeight, {
    color: '#ef4444',
    markerId: 'playedArrow',
    opacity: 0.9,
  });
  const bestArrow = bestMoveArrow(blunder, orientation, tile, labelHeight);

  const squares = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const light = (row + col) % 2 === 0;
      squares.push(
        `<rect x="${col * tile}" y="${labelHeight + row * tile}" width="${tile}" height="${tile}" fill="${light ? '#f0d9b5' : '#b58863'}"/>`,
      );
    }
  }

  const pieceNodes = pieces.map(({ piece, row, col }) => {
    const href = getPieceImage(piece);
    const padding = tile * 0.08;
    return `<image href="${href}" x="${col * tile + padding}" y="${labelHeight + row * tile + padding}" width="${tile - padding * 2}" height="${tile - padding * 2}"/>`;
  });

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${boardSize}" height="${totalHeight}" viewBox="0 0 ${boardSize} ${totalHeight}">
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L8,3 z" fill="#ef4444"/>
    </marker>
    <marker id="bestArrowhead" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L8,3 z" fill="#22c55e"/>
    </marker>
  </defs>
  <rect width="${boardSize}" height="${totalHeight}" fill="#18181b"/>
  <text x="24" y="32" fill="#f8fafc" font-size="24" font-weight="700" font-family="Inter, Arial">Blunder: ${escapeXml(blunder.moveNumber)} ${escapeXml(blunder.san)}</text>
  <text x="24" y="62" fill="#fecaca" font-size="20" font-family="Inter, Arial">${escapeXml(formatCaption(blunder))}</text>
  <text x="24" y="88" fill="#cbd5e1" font-size="18" font-family="Inter, Arial">Red = played. Green = best: ${escapeXml(blunder.bestMoveSan || blunder.bestMove || 'unknown')}.</text>
  ${squares.join('\n  ')}
  ${bestArrow}
  ${playedArrow}
  ${pieceNodes.join('\n  ')}
</svg>`;
}

function getPieceImage(piece) {
  pieceImages ||= loadPieceImages();
  return pieceImages[PIECES[piece]];
}

function loadPieceImages() {
  const pieceDir = path.resolve(__dirname, '..', 'vendor', 'pieces', 'cburnett');
  const images = {};
  for (const name of Object.values(PIECES)) {
    const svg = fs.readFileSync(path.join(pieceDir, `${name}.svg`));
    images[name] = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  }
  return images;
}

function fenToPieces(fen, orientation) {
  const placement = fen.split(' ')[0];
  const pieces = [];
  const ranks = placement.split('/');

  ranks.forEach((rank, rankIndex) => {
    let fileIndex = 0;
    for (const char of rank) {
      if (/\d/.test(char)) {
        fileIndex += Number(char);
        continue;
      }
      const row = orientation === 'w' ? rankIndex : 7 - rankIndex;
      const col = orientation === 'w' ? fileIndex : 7 - fileIndex;
      pieces.push({ piece: char, row, col });
      fileIndex += 1;
    }
  });

  return pieces;
}

function formatCaption(blunder) {
  if (blunder.dropCp > 90_000) return 'lost forced mate';
  return `dropped ${(blunder.dropCp / 100).toFixed(1)} pawns`;
}

function moveArrow(fromSquare, toSquare, orientation, tile, labelHeight, options) {
  if (!fromSquare || !toSquare) return '';
  const from = squareCenter(fromSquare, orientation, tile, labelHeight);
  const to = squareCenter(toSquare, orientation, tile, labelHeight);
  const marker = options.markerId === 'bestArrow' ? 'bestArrowhead' : 'arrowhead';
  return [
    `<circle cx="${from.x}" cy="${from.y}" r="${tile * 0.16}" fill="${options.color}" opacity="${options.opacity}"/>`,
    `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${options.color}" stroke-width="${Math.max(7, tile * 0.085)}" stroke-linecap="round" marker-end="url(#${marker})" opacity="${options.opacity}"/>`,
    `<circle cx="${to.x}" cy="${to.y}" r="${tile * 0.16}" fill="${options.color}" opacity="${options.opacity}"/>`,
  ].join('\n  ');
}

function bestMoveArrow(blunder, orientation, tile, labelHeight) {
  if (!blunder.bestMove || blunder.bestMove.length < 4) return '';
  return moveArrow(blunder.bestMove.slice(0, 2), blunder.bestMove.slice(2, 4), orientation, tile, labelHeight, {
    color: '#22c55e',
    markerId: 'bestArrow',
    opacity: 0.78,
  });
}

function squareCenter(square, orientation, tile, labelHeight) {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(square[1]);
  const col = orientation === 'w' ? file : 7 - file;
  const row = orientation === 'w' ? 8 - rank : rank - 1;
  return {
    x: col * tile + tile / 2,
    y: labelHeight + row * tile + tile / 2,
  };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { renderBlunderSheet };
