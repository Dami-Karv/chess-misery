const { REST, Routes } = require('discord.js');
const config = require('./config');
const { buildCommands } = require('./commands');

async function main() {
  if (!config.discordToken) throw new Error('DISCORD_TOKEN is missing.');
  if (!config.clientId) throw new Error('DISCORD_CLIENT_ID is missing.');

  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);

  const commands = buildCommands();
  await rest.put(route, { body: commands });
  console.log(
    `Registered ${commands.length} slash commands ${config.guildId ? `for guild ${config.guildId}` : 'globally'}.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
