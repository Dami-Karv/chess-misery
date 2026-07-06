function normalizeChessUsername(username) {
  return String(username || '').trim().toLowerCase();
}

module.exports = { normalizeChessUsername };
