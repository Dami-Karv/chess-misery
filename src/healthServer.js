const http = require('node:http');

function startHealthServer(config = {}) {
  const port = config.healthPort || 3000;

  const server = http.createServer((request, response) => {
    const ok = request.url === '/health' || request.url === '/';
    const body = JSON.stringify(
      ok
        ? { ok: true, service: 'chessmisery', uptimeSeconds: Math.round(process.uptime()) }
        : { ok: false },
    );

    response.writeHead(ok ? 200 : 404, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Health server listening on port ${port}`);
  });

  return server;
}

module.exports = { startHealthServer };
