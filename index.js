const config = require('./src/config');
const { start } = require('./src/bot');
const { startHealthServer } = require('./src/healthServer');

if (config.healthServerEnabled) {
  startHealthServer(config);
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
