const { spawn } = require('node:child_process');

const CACHE_MAX = 5_000;

class StockfishEngine {
  constructor(config) {
    this.config = config;
    this.waiters = [];
    this.cache = new Map();
    this.process = null;
    this.startPromise = null;
    this.queue = Promise.resolve();
  }

  async start() {
    if (this.process && !this.process.killed) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startProcess();
    return this.startPromise;
  }

  async startProcess() {
    this.process = spawn(process.execPath, [this.config.stockfishPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout.on('data', (chunk) => this.handleOutput(chunk));
    this.process.stderr.on('data', (chunk) => this.handleOutput(chunk));
    this.process.on('exit', (code) => {
      for (const waiter of this.waiters.splice(0)) {
        waiter.reject(new Error(`Stockfish exited with code ${code}`));
      }
      this.process = null;
      this.startPromise = null;
    });

    await this.sendAndWait('uci', (line) => line === 'uciok', 10_000);
    this.send('setoption name Hash value 32');
    await this.sendAndWait('isready', (line) => line === 'readyok', 10_000);
  }

  handleOutput(chunk) {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(trimmed)) {
          clearTimeout(waiter.timer);
          this.waiters = this.waiters.filter((item) => item !== waiter);
          waiter.resolve(trimmed);
        }
      }
    }
  }

  send(command) {
    this.process.stdin.write(`${command}\n`);
  }

  sendAndWait(command, predicate, timeoutMs) {
    this.send(command);
    return this.waitFor(predicate, timeoutMs);
  }

  waitFor(predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter);
          reject(new Error('Timed out waiting for Stockfish'));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  async evaluateFen(fen) {
    this.queue = this.queue.catch(() => {}).then(() => this.evaluateFenLocked(fen));
    return this.queue;
  }

  async evaluateFenLocked(fen) {
    if (this.cache.has(fen)) return this.cache.get(fen);
    await this.start();

    const searchLines = [];
    this.send(`position fen ${fen}`);
    this.send(`go depth ${this.config.analysisDepth}`);
    const bestMoveLine = await this.waitFor((line) => {
      searchLines.push(line);
      return line.startsWith('bestmove');
    }, 20_000);

    const score = parseScore(searchLines);
    if (score === null) throw new Error('Stockfish did not return a score');

    const sideToMove = fen.split(' ')[1];
    const cpForWhite = sideToMove === 'w' ? score : -score;
    const evaluation = {
      cpForWhite,
      bestMove: parseBestMove(bestMoveLine),
    };
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(fen, evaluation);
    return evaluation;
  }

  async close() {
    if (!this.process || this.process.killed) return;
    const processToClose = this.process;
    const exited = new Promise((resolve) => processToClose.once('exit', resolve));
    this.send('quit');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  }
}

function parseScore(lines) {
  let latest = null;
  for (const line of lines) {
    const match = line.match(/\bscore (cp|mate) (-?\d+)/);
    if (!match) continue;
    const value = Number.parseInt(match[2], 10);
    latest = match[1] === 'mate' ? mateToCp(value) : value;
  }
  return latest;
}

function parseBestMove(line) {
  const match = line.match(/^bestmove\s+(\S+)/);
  return match && match[1] !== '(none)' ? match[1] : null;
}

function mateToCp(mate) {
  if (mate === 0) return 0;
  return Math.sign(mate) * (100_000 - Math.min(Math.abs(mate), 100) * 100);
}

module.exports = { StockfishEngine };
