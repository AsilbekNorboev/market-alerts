import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PriceAlerts } from '../price-alerts.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eth-alerts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'alerts.json');
  return { file, store: new PriceAlerts(file) };
}
const base = { user: 'u1', guild: 'g1', channel: 'c1', current: 2500 };
test('targets cross in either direction, including jumps past the price', t => {
  const { store } = fixture(t);
  const down = store.create({ ...base, price: 2300 });
  const up = store.create({ ...base, price: 2700 });
  store.observe(2400, 1);
  assert.equal(store.rows.some(a => a.pending), false);
  store.observe(2299, 2);
  assert.equal(store.rows.find(a => a.id === down.id).pending.price, 2299);
  assert.equal(store.rows.find(a => a.id === up.id).pending, undefined);
  store.observe(2700, 3);
  assert.equal(store.rows.find(a => a.id === up.id).pending.price, 2700);
});
test('saved and triggered alerts survive restart until delivery succeeds', t => {
  const { store, file } = fixture(t);
  const alert = store.create({ ...base, price: 2300 });
  const restored = new PriceAlerts(file);
  assert.equal(restored.rows[0].id, alert.id);
  restored.observe(2300, 10);
  restored.observe(2400, 11);
  const pending = new PriceAlerts(file);
  assert.deepEqual(pending.rows[0].pending, { price: 2300, time: 10 });
  pending.delivered(alert.id);
  assert.equal(new PriceAlerts(file).rows.length, 0);
});
test('only the owner in the same server can list or cancel an alert', t => {
  const { store } = fixture(t);
  const a = store.create({ ...base, price: 2300 });
  assert.equal(store.list('u2', 'g1').length, 0);
  assert.equal(store.cancel(a.id, 'u2', 'g1'), false);
  assert.equal(store.cancel(a.id, 'u1', 'g2'), false);
  assert.equal(store.cancel(a.id, 'u1', 'g1'), true);
});
test('invalid prices and per-user alert overflow are rejected', t => {
  const { store } = fixture(t);
  for (const price of [0, -1, NaN, Infinity]) assert.throws(() => store.create({ ...base, price }));
  for (let i = 0; i < 25; i++) store.create({ ...base, price: 2300 + i });
  assert.throws(() => store.create({ ...base, price: 2400 }));
});
