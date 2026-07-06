![Chess Misery](main-image.jpg)

# Chess Misery Discord Bot

Posts a image report on your prefered discord channel when a linked Chess.com user loses a game. Reports include the opponent, result, estimated Elo change, new rating, and locally computed blunders from the game PGN.

## Lightweight

No database server needed. State is stored in a single JSON file by default, so the bot runs anywhere Node.js does — a cheap VPS, Render's free tier, or your own machine. For persistent cloud deploys (Heroku, Render, Railway) you can point it at an Upstash Redis instance instead. The Stockfish engine and chess piece assets are bundled in `vendor/` so there are no extra installs.

## Setup

1. Create a Discord application and bot in the Discord Developer Portal.
2. Enable the bot with the `bot` and `applications.commands` scopes.
3. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and optionally `DISCORD_GUILD_ID`.
4. `npm install`
5. `npm run deploy` — registers slash commands.
6. `npm start`

For cloud deploys set config vars instead of committing a `.env` file. If the filesystem is ephemeral (Heroku), set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for persistent storage.

## Commands

All commands are slash commands. Commands marked **Manage Server** require that permission.

| Command | Description |
|---|---|
| `/set-loss-channel` | Set the channel for loss reports. **Manage Server** |
| `/link-chess` | Link a Discord user to a Chess.com username. |
| `/unlink-chess` | Remove a link. |
| `/chess-links` | Show current links. |
| `/set-loss-filters` | Filter which losses get reported (time class, rated only, min Elo loss, etc.). **Manage Server** |
| `/loss-filters` | Show current filters. |
| `/set-analysis-depth` | Set Stockfish depth 1–20. Higher = stronger but slower. Default is 8. **Manage Server** |
| `/check-chess-losses` | Trigger an immediate poll. **Manage Server** |

## Notes

Chess.com's public API is read-only and may be cached on their end, so reports are not instant. The bot polls the current and previous monthly archives and seeds history on first link so only future losses are reported.

Blunder detection runs local Stockfish analysis on the game PGN. Chess.com's own Game Review is not available through the public API.
