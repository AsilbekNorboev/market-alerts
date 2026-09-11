import test from 'node:test';
import assert from 'node:assert/strict';
import { MoveDetector, sendDiscord } from '../eth-discord-alert.mjs';

test('detects moves in either direction within a rolling minute', () => {
  for (const price of [2020, 1980]) {
    const d = new MoveDetector();
    d.add(0, 2000);
    assert.equal(d.add(60000, price).direction, price > 2000 ? 'up' : 'down');
  }
});
test('expires old prices and ignores invalid/out of order ticks', () => {
  const d = new MoveDetector();
  d.add(0, 2000);
  assert.equal(d.add(60001, 2100), null);
  assert.equal(d.add(60000, 1000), null);
  assert.equal(d.add(60002, NaN), null);
});
test('cooldown starts on delivery and leaves opposite direction available', () => {
  const d = new MoveDetector();
  d.add(0, 2000);
  const move = d.add(1000, 2020);
  assert.ok(d.add(2000, 2021));
  d.delivered(move);
  assert.equal(d.add(3000, 2022), null);
  assert.equal(d.add(4000, 1990).direction, 'down');
  d.reset();
  assert.equal(d.add(5000, 3000), null);
});
test('Discord confirms delivery, disables mentions, and reports rate limits', async () => {
  const url = 'https://discord.com/api/webhooks/123/test';
  await sendDiscord(url, 'hello', async (target, options) => {
    assert.equal(target.searchParams.get('wait'), 'true');
    assert.deepEqual(JSON.parse(options.body).allowed_mentions.parse, []);
    return { ok: true };
  });
  await assert.rejects(sendDiscord(url, 'hello', async () => ({ ok: false, status: 429, json: async () => ({ retry_after: 45 }) })), e => e.retryMs === 45000);
});

