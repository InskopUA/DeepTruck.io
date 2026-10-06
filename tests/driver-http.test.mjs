import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchJson } from '../driver-app/src/http.ts';

test('Driver transport works without AbortSignal.timeout, cancels stalled bodies and allows retries', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
  Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
  t.after(() => Object.defineProperty(AbortSignal, 'timeout', descriptor));
  const server = http.createServer(async (req, res) => {
    if (req.url === '/stall-headers') return;
    if (req.url === '/stall-body') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.flushHeaders(); res.write('{"items":'); return;
    }
    if (req.url === '/unauthorized') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Please sign in again.' })); return;
    }
    assert.equal(req.headers.authorization, 'Bearer fixture-session');
    let body = ''; for await (const chunk of req) body += chunk;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ items: [{ id: 'invited-load', status: 'pending' }], payload: body ? JSON.parse(body) : null }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: 'Bearer fixture-session', 'Content-Type': 'application/json' };
  assert.equal(AbortSignal.timeout, undefined);
  const loads = await fetchJson(origin + '/driver/loads', { headers });
  assert.equal(loads.response.status, 200);
  assert.equal(loads.value.items[0].id, 'invited-load');
  const accepted = await fetchJson(origin + '/driver/loads/invited-load/accept', { method: 'POST', headers, body: '{}' });
  assert.deepEqual(accepted.value.payload, {});
  const unauthorized = await fetchJson(origin + '/unauthorized');
  assert.equal(unauthorized.response.status, 401);
  assert.equal(unauthorized.value.error, 'Please sign in again.');
  for (const path of ['/stall-headers', '/stall-body']) {
    await assert.rejects(fetchJson(origin + path, {}, 40), /Request timed out/);
    assert.equal((await fetchJson(origin + '/driver/loads', { headers })).value.items.length, 1, 'a timeout must not abort a later request');
  }
  await assert.rejects(fetchJson('http://127.0.0.1:1/driver/loads'), /Could not connect to tracking/);
});
