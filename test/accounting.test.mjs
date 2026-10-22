import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tokenTotal, emptySession, foldEvent, summarize, buildWeeks, periodData, yearStart, dateKey } from '../lib/core.js';
import { UsageStore, apply } from '../lib/index.js';

const testTemp = path.resolve('verification/test-tmp');
await fs.mkdir(testTemp, { recursive: true });

const time = Date.parse('2026-10-20T02:00:00Z');
const message = (seq, model, total, timestamp = time) => ({ seq, type: 'assistant/message', time: timestamp, data: { message: { source: { model } }, usage: { inputTokens: total - 10, outputTokens: 10, cacheReadTokens: 50, totalTokens: total }, stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { totalTokens: total } } }] } });
const ledger = () => ({ version: 1, sessions: {} });

test('provider totals include cache and reasoning exactly once; no token estimates', () => {
  assert.equal(tokenTotal({ inputTokens: 900, outputTokens: 174, cacheReadTokens: 8576, totalTokens: 9650 }), 9650);
  assert.equal(tokenTotal({ inputTokens: 9500, outputTokens: 100, cacheReadTokens: 8500, totalTokens: 9600 }), 9600);
  assert.equal(tokenTotal({ inputTokens: 50, outputTokens: 100, cacheReadTokens: 30, cacheWriteTokens: 20 }), 200);
  assert.equal(tokenTotal(undefined), null);
  assert.equal(tokenTotal({ totalTokens: -2 }), null);
  assert.equal(tokenTotal({ totalTokens: NaN }), null);
});

test('stream snapshots are not summed or double counted; retries keep reported usage', () => {
  const row = emptySession();
  foldEvent(row, { seq: 0, type: 'request/header', data: { header: { config: { model: 'retry-model' } } } });
  foldEvent(row, { seq: 1, time, type: 'assistant/attempt', data: { stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { totalTokens: 40 } } }, { type: 'chunk', chunk: { type: 'usage', usage: { totalTokens: 60 } } }] } });
  foldEvent(row, message(2, 'gpt', 100));
  foldEvent(row, message(2, 'gpt', 100));
  foldEvent(row, { seq: 3, type: 'assistant/attempt', time, data: { stream: [] } });
  const result = summarize({ sessions: { a: row } }, time);
  assert.equal(result.total, 160);
  assert.equal(result.missingUsage, 1);
  assert.equal(result.models.find(m => m.id === 'retry-model').total, 60);
});

test('Shanghai date boundaries, Monday weeks, annual cumulative and lifetime peak', () => {
  assert.equal(dateKey(Date.parse('2026-10-19T16:01:00Z')), '2026-10-20');
  assert.equal(yearStart('2024-02-29'), '2023-03-01');
  const row = emptySession();
  foldEvent(row, message(0, 'old-model', 9000, Date.parse('2024-10-20T02:00:00Z')));
  foldEvent(row, message(1, 'new-model', 100, Date.parse('2026-10-18T02:00:00Z')));
  foldEvent(row, message(2, 'new-model', 200, time));
  const stats = summarize({ sessions: { a: row } }, time), weeks = buildWeeks(stats);
  assert.equal(stats.total, 9300);
  assert.equal(stats.peak.date, '2024-10-20');
  assert.equal(stats.models[0].id, 'old-model');
  assert.equal(weeks.at(-1).cumulative, 300);
  assert.equal(weeks.at(-1).start, '2026-10-19');
  assert.equal(weeks.at(-1).total, 200);
  assert.equal(weeks.at(-2).total, 100);
  assert.equal(weeks.flatMap(w => w.cells).filter(d => d.enabled).length, 365);
  assert.equal(periodData(stats, 7).total, 300);
  assert.equal(periodData(stats, 30).total, 300);
});

test('incremental persistence survives restarts, concurrent refreshes, deleted logs and fork imports', async () => {
  const dir = await fs.mkdtemp(path.join(testTemp, 'dsh-token-test-'));
  const file = path.join(dir, 'ledger.json');
  let events = [message(0, 'a', 100)], revision = 'v1', includeOriginal = true;
  let closes = 0;
  const storage = {
    async list() { return [...(includeOriginal ? [{ header: { id: 'parent' }, revision }] : []), { header: { id: 'child' }, revision: 'child1' }]; },
    async open(id) {
      return { inheritedEventCount: id === 'child' ? 1 : 0, async read(offset = 0, length = Infinity) { const log = id === 'child' ? [events[0], message(1, 'b', 50)] : events; return { events: log.filter(e => e.seq >= offset && e.seq < offset + length) }; }, async close() { closes++; } };
    }
  };
  let store = new UsageStore(storage, file);
  let stats = await store.sync();
  assert.equal(stats.total, 150);
  events.push(message(1, 'a', 200)); revision = 'v2';
  const [a, b] = await Promise.all([store.sync(), store.sync()]);
  assert.equal(a.total, 350); assert.equal(b.total, 350);
  store = new UsageStore(storage, file);
  assert.equal((await store.sync()).total, 350);
  includeOriginal = false;
  assert.equal((await store.sync()).total, 350);
  assert.equal(closes, 3);
});

test('an unreadable ledger is preserved and never replaced with zero', async () => {
  const dir = await fs.mkdtemp(path.join(testTemp, 'dsh-token-corrupt-')), file = path.join(dir, 'ledger.json');
  await fs.writeFile(file, '{broken');
  const store = new UsageStore({ list: async () => [] }, file);
  await assert.rejects(store.sync(), /原文件已保留/);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});

test('statistics endpoint enforces authentication and rejects mutation methods', async () => {
  let route;
  const ctx = { sessionPersistence: { list: async () => [] }, logger: { warn() {} }, on() {}, connection: { requestRejection: () => 403 }, webServer: { register(value) { route = value; return () => {}; } }, effect(fn, label) { if (label.includes('authenticated')) fn(); } };
  apply(ctx);
  const response = () => ({ writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } });
  let res = response();
  await route.handler({ method: 'GET' }, res);
  assert.equal(res.status, 403);
  ctx.connection.requestRejection = () => undefined;
  res = response(); await route.handler({ method: 'POST' }, res);
  assert.equal(res.status, 405);
});
