import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class PriceAlerts {
  constructor(file) {
    this.file = file;
    this.rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    if (!Array.isArray(this.rows)) throw new Error('Invalid alert database');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.save(this.rows);
  }
  save(rows) {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(rows, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
    this.rows = rows;
  }
  list(user, guild) { return this.rows.filter(a => a.user === user && a.guild === guild); }
  create({ user, guild, channel, price, current }) {
    if (![price, current].every(p => Number.isFinite(p) && p > 0) || price > 100000000) throw new Error('Enter a valid positive ETH price.');
    if (this.list(user, guild).length >= 25) throw new Error('You can have up to 25 active alerts. Cancel one first.');
    if (this.rows.length >= 1000) throw new Error('The bot has reached its alert limit.');
    const row = { id: randomUUID().slice(0, 8), user, guild, channel, price, direction: price >= current ? 'up' : 'down', created: Date.now() };
    this.save([...this.rows, row]);
    return row;
  }
  cancel(id, user, guild) {
    const rows = this.rows.filter(a => !(a.id === id && a.user === user && a.guild === guild));
    if (rows.length === this.rows.length) return false;
    this.save(rows);
    return true;
  }
  observe(price, time) {
    let changed = false;
    const rows = this.rows.map(a => {
      if (a.pending || !(a.direction === 'up' ? price >= a.price : price <= a.price)) return a;
      changed = true;
      return { ...a, pending: { price, time } };
    });
    if (changed) this.save(rows);
  }
  delivered(id) { this.save(this.rows.filter(a => a.id !== id)); }
}
