// Only provider-reported usage is counted. Message text is never retained.
export const TIME_ZONE = 'Asia/Shanghai';
export function dateKey(time) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
}
export function shiftDay(date, offset) {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
export function yearStart(today) {
  const value = new Date(today + 'T12:00:00Z');
  const month = value.getUTCMonth();
  value.setUTCFullYear(value.getUTCFullYear() - 1);
  if (value.getUTCMonth() !== month) value.setUTCDate(0);
  return shiftDay(value.toISOString().slice(0, 10), 1);
}
export function tokenTotal(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const valid = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  // Adapters differ: some input counts exclude cached tokens. The reported
  // total already resolves that distinction and includes reasoning output.
  if (valid(usage.totalTokens)) return usage.totalTokens;
  if (!valid(usage.inputTokens) || !valid(usage.outputTokens)) return null;
  // DSH's usage contract exposes cache reads/writes as separate input buckets.
  const total = usage.inputTokens + usage.outputTokens + (valid(usage.cacheReadTokens) ? usage.cacheReadTokens : 0) + (valid(usage.cacheWriteTokens) ? usage.cacheWriteTokens : 0);
  return Number.isSafeInteger(total) ? total : null;
}
export function streamUsage(stream) {
  let usage;
  for (const entry of Array.isArray(stream) ? stream : []) {
    const chunk = entry.type === 'chunk' ? entry.chunk : entry;
    if (chunk?.type === 'usage') usage = chunk.usage;
  }
  return usage;
}
export function emptySession(inherited = 0) {
  return { nextSeq: inherited, route: {}, days: {}, missingUsage: 0 };
}
export function foldEvent(row, event) {
  if (!Number.isSafeInteger(event.seq) || event.seq < row.nextSeq) return false;
  row.nextSeq = event.seq + 1;
  const data = event.data || {};
  if (event.type === 'model/selection') row.route = { provider: data.provider, model: data.model };
  if (event.type === 'request/header') {
    const config = data.header?.config;
    if (config?.model) row.route = { provider: config.provider, model: config.model };
  }
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return true;
  const usage = data.usage ?? streamUsage(data.stream);
  const total = tokenTotal(usage);
  if (total === null) { row.missingUsage++; return true; }
  if (total === 0) return true;
  if (!Number.isFinite(event.time) || event.time < 0) { row.missingUsage++; return true; }
  const source = data.message?.source;
  const model = String(source?.model || row.route.model || '未知模型');
  const day = dateKey(event.time), key = 'model:' + model;
  row.days[day] ??= {};
  row.days[day][key] = (row.days[day][key] || 0) + total;
  return true;
}
export function summarize(ledger, now = Date.now()) {
  const byDay = new Map(), byModel = new Map();
  let missingUsage = 0;
  for (const row of Object.values(ledger.sessions)) {
    missingUsage += row.missingUsage || 0;
    for (const [date, models] of Object.entries(row.days)) {
      if (!byDay.has(date)) byDay.set(date, new Map());
      for (const [key, total] of Object.entries(models)) {
        const id = key.slice(6);
        byDay.get(date).set(id, (byDay.get(date).get(id) || 0) + total);
        byModel.set(id, (byModel.get(id) || 0) + total);
      }
    }
  }
  const days = [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, models]) => ({ date, models: Object.fromEntries(models), total: [...models.values()].reduce((a, b) => a + b, 0) }));
  const models = [...byModel].map(([id, total]) => ({ id, total })).sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  const peak = days.reduce((best, day) => day.total > (best?.total || 0) ? day : best, null);
  return { today: dateKey(now), timeZone: TIME_ZONE, updatedAt: now, total: models.reduce((sum, model) => sum + model.total, 0), models, days, peak, missingUsage };
}
export function buildWeeks(stats) {
  const start = yearStart(stats.today), end = stats.today;
  const offset = (new Date(start + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const first = shiftDay(start, -offset), days = new Map(stats.days.map(day => [day.date, day]));
  const weeks = [];
  let running = 0;
  for (let monday = first; monday <= end; monday = shiftDay(monday, 7)) {
    const cells = Array.from({ length: 7 }, (_, i) => {
      const date = shiftDay(monday, i);
      return { date, enabled: date >= start && date <= end, total: date >= start && date <= end ? (days.get(date)?.total || 0) : 0 };
    });
    const total = cells.reduce((sum, day) => sum + day.total, 0);
    running += total;
    weeks.push({ start: cells.find(day => day.enabled)?.date, end: cells.filter(day => day.enabled).at(-1)?.date, cells, total, cumulative: running });
  }
  return weeks;
}
export function periodData(stats, length) {
  const start = shiftDay(stats.today, 1 - length), map = new Map(stats.days.map(day => [day.date, day]));
  const days = Array.from({ length }, (_, i) => {
    const date = shiftDay(start, i);
    return map.get(date) || { date, total: 0, models: {} };
  });
  const models = stats.models.map(model => ({ ...model, total: days.reduce((sum, day) => sum + (Object.hasOwn(day.models, model.id) ? day.models[model.id] : 0), 0) })).filter(model => model.total > 0);
  return { start, days, models, total: models.reduce((sum, model) => sum + model.total, 0) };
}
