# Chess Misery Discord Bot

Posts a Discord report when a linked Chess.com user loses a game. Reports include the opponent, result, estimated Elo change, new rating, and locally computed blunders from the game PGN.

## Setup

1. Create a Discord application and bot in the Discord Developer Portal.
2. Enable the bot in your server with the `bot` and `applications.commands` scopes.
3. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and optionally `DISCORD_GUILD_ID`.
4. Install dependencies:

```bash
npm install
```

5. Register slash commands:

```bash
npm run deploy
```

6. Start the bot:

```bash
npm start
```

## Heroku

Heroku does not currently offer free dynos. If you deploy there, use a worker dyno; the included `Procfile` runs `npm start`.

Set these config vars in Heroku instead of committing a `.env` file:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`, optional but recommended while testing
- `CHESS_COM_USER_AGENT`
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, recommended for persistent storage

Run slash-command registration once after setting config vars:

```bash
heroku run npm run deploy
```

Important: Heroku's filesystem is ephemeral. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for persistent storage. Without them, the default JSON database can be lost on deploy/restart.

## Render

Deploy as a Node.js Web Service, not a background worker, if you want to use Render's free web-service tier.

- Build command: `npm install`
- Start command: `npm start`
- Health endpoint: `/health`

The bot starts a tiny HTTP server on `PORT` for Render health checks and uptime pings. Set `HEALTH_SERVER_ENABLED=false` only on hosts where you do not want an HTTP listener.

## Discord Commands

- `/set-loss-channel channel:#channel` sets the report channel. Requires Manage Server.
- `/link-chess username:<name> [user:@member]` links yourself, or links another member if you have Manage Server.
- `/unlink-chess [user:@member]` removes a link.
- `/chess-links` shows current links.
- `/check-chess-losses` runs an immediate poll. Requires Manage Server.

## Notes

Chess.com PubAPI is read-only and can be cached by Chess.com, so reports are not instant. The bot polls the current and previous monthly archives and avoids posting old games when a user is first linked.

Chess.com does not expose full Game Review blunder classifications through the public API. This bot estimates blunders by running local Stockfish analysis on the PGN and counting moves where the linked player drops at least `BLUNDER_THRESHOLD_CP` centipawns.

The bundled Stockfish Lite engine lives in `vendor/stockfish` so deploys do not need to install the much larger upstream npm package.

Board images use the Cburnett SVG chess pieces from Lichess's public piece assets, bundled in `vendor/pieces/cburnett`.
