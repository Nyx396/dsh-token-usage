import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { emptySession, foldEvent, summarize } from './core.js';

export const name = 'dsh-token-usage';
export const inject = ['webServer', 'connection', 'sessionPersistence'];

export class UsageStore {
  constructor(persistence, file, logger = console) {
    this.persistence = persistence;
    this.file = file;
    this.logger = logger;
    this.ledger = { version: 1, sessions: {} };
    this.warnings = [];
    this.queue = Promise.resolve();
    this.ready = this.load();
  }
  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (parsed.version !== 1 || !parsed.sessions || typeof parsed.sessions !== 'object') throw new Error('统计文件格式不正确');
      for (const row of Object.values(parsed.sessions)) {
        if (!row.days || !Number.isSafeInteger(row.nextSeq)) throw new Error('统计文件内容不完整');
      }
      this.ledger = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('无法读取已有用量统计，原文件已保留：' + error.message);
    }
  }
  sync() {
    const operation = this.queue.then(() => this.run());
    this.queue = operation.catch(() => {});
    return operation;
  }
  async run() {
    await this.ready;
    const snapshots = await this.persistence.list();
    this.warnings = [];
    for (const snapshot of snapshots) {
      const id = snapshot.header.id;
      const key = 'session:' + id;
      const previous = this.ledger.sessions[key];
      if (previous?.revision === snapshot.revision) continue;
      let handle;
      try {
        handle = await this.persistence.open(id, 'read');
        const inherited = handle.inheritedEventCount || 0;
        const row = previous ? structuredClone(previous) : emptySession(inherited);
        // Read route headers in the inherited prefix only as context. Never
        // charge copied assistant events to a forked session again.
        if (!previous && inherited > 0) {
          const prefix = await handle.read(0, inherited);
          for (const event of prefix.events) if (event.type === 'model/selection' || event.type === 'request/header') {
            const context = emptySession();
            context.route = row.route;
            foldEvent(context, event);
            row.route = context.route;
          }
        }
        const result = await handle.read(Math.max(inherited, row.nextSeq));
        for (const event of result.events) foldEvent(row, event);
        row.revision = snapshot.revision;
        this.ledger.sessions[key] = row;
      } catch (error) {
        this.warnings.push('有会话暂时无法读取，其已保存的统计仍保留。');
        this.logger.warn?.('[token-usage] session import: ' + String(error.message));
      } finally { await handle?.close(); }
    }
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.tmp';
    await fs.writeFile(temp, JSON.stringify(this.ledger), { mode: 0o600 });
    await fs.rename(temp, this.file);
    return { ...summarize(this.ledger), warnings: [...new Set(this.warnings)] };
  }
}

export function apply(ctx) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const store = new UsageStore(ctx.sessionPersistence, path.join(home, 'token-usage', 'ledger-v1.json'), ctx.logger);
  const refresh = () => store.sync().catch(error => ctx.logger.warn('[token-usage] ' + error.message));
  let pending;
  ctx.on('session/event', (_session, event) => {
    if (!['assistant/message', 'assistant/attempt', 'turn/end'].includes(event.type)) return;
    clearTimeout(pending);
    pending = setTimeout(refresh, 800);
    pending.unref?.();
  });
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/dsh-token-usage/stats',
    handler: async (req, res) => {
      const send = (code, body) => {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(body));
      };
      // Fail closed: usage history is readable only by an authenticated peer.
      try {
        const rejection = ctx.connection.requestRejection(req);
        if (rejection !== undefined && rejection !== null && rejection !== false) { send(Number(rejection) || 403, { error: '无权读取用量统计' }); return; }
        if (req.method !== 'GET') { send(405, { error: 'method not allowed' }); return; }
        send(200, await store.sync());
      } catch (error) { send(500, { error: error.message || '用量统计读取失败' }); }
    }
  }), 'token-usage: authenticated statistics');
  ctx.effect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    timer.unref?.();
    return async () => { clearInterval(timer); clearTimeout(pending); await store.queue; };
  }, 'token-usage: durable history');
}
