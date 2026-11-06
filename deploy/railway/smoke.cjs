// Run after compose.smoke.yml starts. No customer data or real credentials.
const assert = require('node:assert/strict');

async function main() {
  const origin = process.env.SMOKE_ORIGIN || 'http://localhost:18080';
  for (const path of ['/healthz', '/', '/login', '/orders']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
    const body = await response.text();
    if (path === '/healthz') assert.equal(body, 'ok');
    else assert.match(body, /<div id="root">/, path);
    console.log(`PASS ${path}`);
  }
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  console.log('PASS API proxy');

  const protectedResponse = await fetch(`${origin}/api/auth/me`);
  assert.equal(protectedResponse.status, 401);
  console.log('PASS authentication guard through proxy');

  const login = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'absent-smoke@example.invalid', password: 'SmokeLocal!123' }),
  });
  assert.equal(login.status, 401, await login.text());
  console.log('PASS login queries fresh database and rejects unknown user');

  const socket = await fetch(`${origin}/socket.io/?EIO=4&transport=polling`);
  assert.equal(socket.status, 200);
  const packet = await socket.text();
  assert.equal(packet[0], '0');
  assert.ok(JSON.parse(packet.slice(1)).sid);
  console.log('PASS Socket.IO Engine.IO handshake through proxy');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
