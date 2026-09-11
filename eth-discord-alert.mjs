import { pathToFileURL } from 'node:url';

export class MoveDetector {
  constructor({ threshold = 1, windowMs = 60000, cooldownMs = 300000 } = {}) {
    if (![threshold, windowMs, cooldownMs].every(Number.isFinite) || threshold <= 0 || windowMs <= 0 || cooldownMs < 0) throw new Error('Invalid detector settings');
    Object.assign(this, { threshold, windowMs, cooldownMs });
    this.points = [];
    this.sent = { up: -Infinity, down: -Infinity };
  }
  reset() { this.points = []; }
  add(time, price) {
    if (!Number.isFinite(time) || !Number.isFinite(price) || price <= 0) return null;
    if (this.points.length && time <= this.points.at(-1).time) return null;
    this.points = this.points.filter(p => time - p.time <= this.windowMs);
    let best = null;
    for (const p of this.points) {
      const percent = (price / p.price - 1) * 100;
      const direction = percent >= 0 ? 'up' : 'down';
      if (Math.abs(percent) + 1e-10 >= this.threshold && time - this.sent[direction] >= this.cooldownMs && (!best || Math.abs(percent) > Math.abs(best.percent))) {
        best = { direction, percent, from: p.price, price, seconds: (time - p.time) / 1000, time };
      }
    }
    this.points.push({ time, price });
    return best;
  }
  delivered(move) { this.sent[move.direction] = move.time; }
}

export function message(move) {
  return `ETH/USD ${move.direction === 'up' ? '▲' : '▼'} ${move.percent >= 0 ? '+' : ''}${move.percent.toFixed(2)}% in ${move.seconds.toFixed(1)}s\n$${move.from.toFixed(2)} → $${move.price.toFixed(2)}\nCoinbase spot • ${new Date(move.time).toISOString()}`;
}

export async function sendDiscord(webhook, content, fetcher = fetch) {
  const url = new URL(webhook);
  if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || !/^\/api\/webhooks\/\d+\/[^/]+$/.test(url.pathname)) throw new Error('Use a Discord channel webhook URL');
  url.searchParams.set('wait', 'true');
  const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    const error = new Error(`Discord returned HTTP ${response.status}`);
    error.retryMs = 30000;
    if (response.status === 429) {
      const body = await response.json().catch(() => ({}));
      error.retryMs = Math.max(30000, (Number(body.retry_after) || 30) * 1000);
    }
    throw error;
  }
}

async function main() {
  if (typeof WebSocket === 'undefined') throw new Error('This monitor requires Node.js 22 or newer');
  const dryRun = process.argv.includes('--dry-run');
  const webhook = process.env.ETH_DISCORD_WEBHOOK_URL;
  if (!dryRun && !webhook) throw new Error('Set ETH_DISCORD_WEBHOOK_URL or use --dry-run');
  const detector = new MoveDetector({ threshold: Number(process.env.ETH_ALERT_PERCENT ?? 1), windowMs: Number(process.env.ETH_ALERT_WINDOW_SECONDS ?? 60) * 1000, cooldownMs: Number(process.env.ETH_ALERT_COOLDOWN_SECONDS ?? 300) * 1000 });
  if (process.argv.includes('--test-alert')) {
    if (dryRun) console.log('TEST: ETH alert monitor connected.');
    else await sendDiscord(webhook, 'TEST: ETH alert monitor connected.');
    return;
  }
  let socket, reconnect, stopped = false, pending = false, retryAt = 0, lastMessage = 0, lastTick = 0, backoff = 1000;
  const log = text => console.log(`${new Date().toISOString()} ${text}`);
  function connect() {
    detector.reset();
    lastTick = 0;
    lastMessage = Date.now();
    socket = new WebSocket('wss://ws-feed.exchange.coinbase.com');
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'subscribe', product_ids: ['ETH-USD'], channels: ['ticker', 'heartbeat'] }));
      log(`Connected; threshold ${detector.threshold}% within ${detector.windowMs / 1000}s; ${dryRun ? 'console only' : 'Discord enabled'}`);
    });
    socket.addEventListener('message', async event => {
      lastMessage = Date.now();
      let tick;
      try { tick = JSON.parse(event.data); } catch { return; }
      if (tick.type === 'error') { log('Feed subscription error; reconnecting'); socket.close(); return; }
      if (tick.type !== 'ticker' || tick.product_id !== 'ETH-USD') return;
      const time = Date.parse(tick.time), price = Number(tick.price);
      if (!Number.isFinite(time) || !Number.isFinite(price) || price <= 0 || Math.abs(Date.now() - time) > 15000) return;
      if (lastTick && Date.now() - lastTick > 15000) detector.reset();
      lastTick = Date.now();
      backoff = 1000;
      const move = detector.add(time, price);
      if (!move || pending || Date.now() < retryAt) return;
      pending = true;
      try {
        if (!dryRun) await sendDiscord(webhook, message(move));
        detector.delivered(move);
        log(message(move));
      } catch (error) {
        // Never log request objects or webhook tokens.
        log('Discord delivery failed; waiting before retrying on a fresh qualifying tick');
        retryAt = Date.now() + (error.retryMs || 30000);
      } finally { pending = false; }
    });
    socket.addEventListener('error', () => socket.close());
    socket.addEventListener('close', () => {
      detector.reset();
      if (!stopped) {
        log(`Feed disconnected; retry in ${backoff / 1000}s`);
        reconnect = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    });
  }
  const watchdog = setInterval(() => { if (Date.now() - lastMessage > 15000) socket?.close(); }, 5000);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    stopped = true;
    clearTimeout(reconnect);
    clearInterval(watchdog);
    socket?.close();
  });
  connect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
