const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName('set-loss-channel')
      .setDescription('Choose where Chess.com loss reports are posted.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('The text channel for loss reports')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),

    new SlashCommandBuilder()
      .setName('link-chess')
      .setDescription('Link a Discord user to a Chess.com username.')
      .addStringOption((option) =>
        option
          .setName('username')
          .setDescription('Chess.com username')
          .setRequired(true),
      )
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('Discord user to link. Requires Manage Server when not yourself.')
          .setRequired(false),
      ),

    new SlashCommandBuilder()
      .setName('unlink-chess')
      .setDescription('Remove a Chess.com link.')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('Discord user to unlink. Requires Manage Server when not yourself.')
          .setRequired(false),
      ),

    new SlashCommandBuilder()
      .setName('chess-links')
      .setDescription('Show the current Chess.com links for this server.'),

    new SlashCommandBuilder()
      .setName('set-loss-filters')
      .setDescription('Choose which Chess.com losses should be reported.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption((option) =>
        option
          .setName('time_classes')
          .setDescription('Comma-separated: bullet, blitz, rapid, daily. Use all to clear.')
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option
          .setName('rated_only')
          .setDescription('Only report rated games.')
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option
          .setName('standard_only')
          .setDescription('Only report standard chess games, ignoring variants.')
          .setRequired(false),
      )
      .addIntegerOption((option) =>
        option
          .setName('min_elo_loss')
          .setDescription('Only report losses with at least this Elo loss. Use 0 to clear.')
          .setMinValue(0)
          .setRequired(false),
      )
      .addIntegerOption((option) =>
        option
          .setName('min_blunders')
          .setDescription('Only report games with at least this many engine blunders. Use 0 to clear.')
          .setMinValue(0)
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option
          .setName('game_ending_only')
          .setDescription('Only report games with a mate-level/game-ending blunder.')
          .setRequired(false),
      ),

    new SlashCommandBuilder()
      .setName('loss-filters')
      .setDescription('Show the current Chess.com loss report filters.'),

    new SlashCommandBuilder()
      .setName('check-chess-losses')
      .setDescription('Check Chess.com now instead of waiting for the next poll.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  ].map((command) => command.toJSON());
}

module.exports = { buildCommands };
