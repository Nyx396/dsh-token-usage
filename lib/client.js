window.__ModuleLoader__.load({id:'dsh-token-usage',factory:(require)=>{
const React=require('react');
// Only provider-reported usage is counted. Message text is never retained.
const TIME_ZONE = 'Asia/Shanghai';
function dateKey(time) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
}
function shiftDay(date, offset) {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
function yearStart(today) {
  const value = new Date(today + 'T12:00:00Z');
  const month = value.getUTCMonth();
  value.setUTCFullYear(value.getUTCFullYear() - 1);
  if (value.getUTCMonth() !== month) value.setUTCDate(0);
  return shiftDay(value.toISOString().slice(0, 10), 1);
}
function tokenTotal(usage) {
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
function streamUsage(stream) {
  let usage;
  for (const entry of Array.isArray(stream) ? stream : []) {
    const chunk = entry.type === 'chunk' ? entry.chunk : entry;
    if (chunk?.type === 'usage') usage = chunk.usage;
  }
  return usage;
}
function emptySession(inherited = 0) {
  return { nextSeq: inherited, route: {}, days: {}, missingUsage: 0 };
}
function foldEvent(row, event) {
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
function summarize(ledger, now = Date.now()) {
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
function buildWeeks(stats) {
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
function periodData(stats, length) {
  const start = shiftDay(stats.today, 1 - length), map = new Map(stats.days.map(day => [day.date, day]));
  const days = Array.from({ length }, (_, i) => {
    const date = shiftDay(start, i);
    return map.get(date) || { date, total: 0, models: {} };
  });
  const models = stats.models.map(model => ({ ...model, total: days.reduce((sum, day) => sum + (Object.hasOwn(day.models, model.id) ? day.models[model.id] : 0), 0) })).filter(model => model.total > 0);
  return { start, days, models, total: models.reduce((sum, model) => sum + model.total, 0) };
}

const CSS=".dtu-root{--dtu-text:var(--dsw-alias-label-primary,#eeeef2);--dtu-muted:var(--dsw-alias-label-tertiary,#95959f);--dtu-border:var(--dsw-alias-border-l2,#38383d);--dtu-bg:var(--dsw-alias-bg-layer-2,#202023);--dtu-card:var(--dsw-alias-bg-layer-3,#27272b);--dtu-accent:#a78bfa;color:var(--dtu-text);font:14px/1.5 inherit;max-width:1120px;min-width:0;padding-bottom:12px}\n.dtu-root *{box-sizing:border-box}.dtu-root button{font:inherit;color:inherit;cursor:pointer}.dtu-root button:disabled{opacity:.55;cursor:wait}.dtu-root button:focus-visible,.dtu-root [tabindex]:focus-visible{outline:2px solid var(--dtu-accent);outline-offset:3px}.dtu-root h2,.dtu-root h3,.dtu-root p{margin:0}.dtu-root h2{font-size:22px;font-weight:650;letter-spacing:-.4px}.dtu-root h3{font-size:15px;font-weight:600}.dtu-page-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}.dtu-page-head p{color:var(--dtu-muted);margin-top:5px;font-size:13px}.dtu-refresh,.dtu-close{border:1px solid var(--dtu-border);border-radius:8px;background:transparent;padding:6px 13px;white-space:nowrap}.dtu-refresh:hover,.dtu-close:hover{background:var(--dtu-card)}.dtu-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:20px}.dtu-summary-card{border:1px solid var(--dtu-border);border-radius:12px;background:var(--dtu-card);padding:16px;text-align:left;display:flex;flex-direction:column;gap:10px;min-width:0}.dtu-root button.dtu-summary-card:hover,.dtu-root button.dtu-summary-card[aria-expanded=true]{border-color:var(--dtu-accent)}.dtu-card-label{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:12px;color:var(--dtu-muted)}.dtu-detail-link{font-size:11px;white-space:nowrap}.dtu-card-value{font-size:29px;line-height:1.15;letter-spacing:-.8px;font-weight:600;font-variant-numeric:tabular-nums}.dtu-card-note{font-size:11px;color:var(--dtu-muted);overflow-wrap:anywhere}.dtu-model-name{font-size:18px;line-height:1.85;font-weight:600;overflow-wrap:anywhere;letter-spacing:-.3px}.dtu-panel{border:1px solid var(--dtu-border);border-radius:12px;padding:20px;margin-bottom:16px;background:var(--dtu-bg);min-width:0}.dtu-section-head{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:17px}.dtu-segments{display:flex;gap:3px;padding:3px;background:var(--dtu-card);border-radius:8px}.dtu-segments button{border:0;border-radius:6px;background:transparent;color:var(--dtu-muted);padding:4px 9px;white-space:nowrap;font-size:12px}.dtu-segments button[aria-pressed=true]{background:var(--dtu-bg);color:var(--dtu-text);box-shadow:0 1px 4px #0002}.dtu-segments button:hover{color:var(--dtu-text)}.dtu-grid-scroll{overflow-x:auto;padding:3px 2px 5px;scrollbar-width:thin}.dtu-heatmap{display:block;width:100%;height:auto}.dtu-axis{font-size:11px;fill:var(--dtu-muted);font-family:inherit}.dtu-cell{cursor:pointer}.dtu-cell-disabled{fill:transparent}.dtu-level-0{fill:var(--dtu-card);background:var(--dtu-card)}.dtu-level-1{fill:#493169;background:#493169}.dtu-level-2{fill:#7243ae;background:#7243ae}.dtu-level-3{fill:#984cf6;background:#984cf6}.dtu-level-4{fill:#c59aff;background:#c59aff}.dtu-cell:hover,.dtu-column:hover rect{stroke:var(--dtu-text);stroke-width:.6}.dtu-heat-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;min-height:24px;font-size:11px;color:var(--dtu-muted)}.dtu-tooltip{font-variant-numeric:tabular-nums;color:var(--dtu-text)}.dtu-scale{display:flex;align-items:center;gap:4px}.dtu-scale i{display:inline-block;width:10px;height:10px;border-radius:2px}.dtu-root .dtu-note{margin-top:8px;font-size:11px;color:var(--dtu-muted)}.dtu-subtitle{color:var(--dtu-muted);font-size:12px}.dtu-root p.dtu-subtitle{margin-top:4px}.dtu-legend{display:flex;flex-wrap:wrap;gap:8px 16px;font-size:12px;margin:0 0 8px}.dtu-legend span{overflow-wrap:anywhere}.dtu-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;flex-shrink:0;vertical-align:middle}.dtu-line{display:block;width:100%;height:auto;min-height:150px;overflow:visible}.dtu-gridline{stroke:var(--dtu-border);stroke-width:.7;stroke-dasharray:3 4}.dtu-crosshair{stroke:var(--dtu-muted);stroke-dasharray:4 4;stroke-width:1;pointer-events:none}.dtu-hit{cursor:crosshair}.dtu-line-tip{min-height:32px;display:flex;flex-wrap:wrap;gap:7px 15px;align-items:center;color:var(--dtu-muted);font-size:11px;font-variant-numeric:tabular-nums;margin-top:8px}.dtu-line-tip strong{color:var(--dtu-text);font-weight:500}.dtu-line-tip span{overflow-wrap:anywhere}.dtu-pie-layout{display:flex;gap:24px;align-items:center}.dtu-pie-visual{width:180px;flex-shrink:0}.dtu-pie{width:180px;height:180px;display:block}.dtu-slice{cursor:pointer;transition:opacity .15s}.dtu-slice:hover,.dtu-slice:focus{opacity:.78}.dtu-pie-empty{fill:var(--dtu-card)}.dtu-period-total{text-align:center;display:flex;flex-direction:column;gap:3px;margin-top:6px}.dtu-period-total strong{font-size:20px;font-variant-numeric:tabular-nums}.dtu-period-total span{font-size:11px;color:var(--dtu-muted)}.dtu-table-wrap{overflow:auto;min-width:0;flex:1}.dtu-table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}.dtu-table caption{text-align:left;font-size:11px;color:var(--dtu-muted);padding-bottom:8px}.dtu-table th,.dtu-table td{text-align:right;padding:10px 5px;border-bottom:1px solid var(--dtu-border);white-space:nowrap}.dtu-table th:first-child{text-align:left;white-space:normal;overflow-wrap:anywhere}.dtu-table th{font-weight:500}.dtu-table thead th{font-size:11px;color:var(--dtu-muted)}.dtu-table tbody tr:last-child>*{border-bottom:0}.dtu-pie-tip{font-size:11px;color:var(--dtu-muted);margin-top:16px;min-height:18px;overflow-wrap:anywhere}.dtu-detail-number{font-size:26px;font-weight:600;margin-bottom:12px!important;font-variant-numeric:tabular-nums}.dtu-detail-number span{font-size:12px;color:var(--dtu-muted);font-weight:400}.dtu-details{border-color:var(--dtu-accent)}.dtu-footnote{font-size:11px;color:var(--dtu-muted);line-height:1.8}.dtu-error,.dtu-warning{padding:12px;border:1px solid #b58251;border-radius:8px;margin-bottom:16px!important;font-size:12px;color:var(--dtu-text)}.dtu-error button{border:0;background:transparent;text-decoration:underline}.dtu-loading,.dtu-empty{padding:24px 0;color:var(--dtu-muted);font-size:13px}\n@media(max-width:650px){.dtu-summary{gap:8px}.dtu-summary-card{padding:12px;gap:8px}.dtu-card-value{font-size:24px}.dtu-model-name{font-size:15px;line-height:1.85}.dtu-detail-link{font-size:10px}.dtu-panel{padding:16px}.dtu-pie-layout{gap:14px}.dtu-pie-visual{width:145px}.dtu-pie{width:145px;height:145px}.dtu-table{font-size:11px}.dtu-table th,.dtu-table td{padding:9px 3px}}\n@media(max-width:440px){.dtu-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.dtu-model-card{grid-column:1/-1}.dtu-pie-layout{flex-direction:column}.dtu-pie-layout .dtu-table-wrap{width:100%}.dtu-root h2{font-size:20px}.dtu-section-head{gap:10px}.dtu-panel{padding:12px}}\n@media(prefers-reduced-motion:reduce){.dtu-root *{transition:none!important}}\n";
const h = React.createElement;
const nf = new Intl.NumberFormat('zh-CN');
const exact = n => nf.format(n || 0);
const short = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n || 0);
const PALETTE = ['#a78bfa', '#38bdf8', '#34d399', '#fb923c', '#f472b6', '#facc15', '#818cf8', '#2dd4bf', '#f87171', '#c4b5fd'];
function colorsFor(models) {
  return new Map([...models].sort((a, b) => a.id.localeCompare(b.id)).map((m, i) => [m.id, PALETTE[i] || `hsl(${(i * 137.508) % 360} 72% 65%)`]));
}
function Segments({ label, value, options, change }) {
  return h('div', { className: 'dtu-segments', role: 'group', 'aria-label': label }, options.map(([id, text]) => h('button', { key: id, type: 'button', 'aria-pressed': value === id, onClick: () => change(id) }, text)));
}
function ModelTable({ models, colors, total, caption }) {
  return h('div', { className: 'dtu-table-wrap' }, h('table', { className: 'dtu-table' },
    h('caption', null, caption),
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, '模型'), h('th', { scope: 'col' }, 'Token 用量'), h('th', { scope: 'col' }, '占比'))),
    h('tbody', null, models.length ? models.map(m => h('tr', { key: m.id }, h('th', { scope: 'row' }, h('span', { className: 'dtu-dot', style: { background: colors.get(m.id) } }), m.id), h('td', null, exact(m.total)), h('td', null, (total ? m.total / total * 100 : 0).toFixed(1) + '%'))) : h('tr', null, h('td', { colSpan: 3 }, '暂无用量记录')))));
}
function Heatmap({ stats }) {
  const [mode, setMode] = React.useState('daily');
  const [selection, setSelection] = React.useState(null);
  const weeks = buildWeeks(stats), step = 19, size = 15, left = 29, top = 8;
  const width = left + weeks.length * step, height = 174;
  const maxDay = Math.max(1, ...weeks.flatMap(w => w.cells.map(d => d.total)));
  const maxColumn = Math.max(1, ...weeks.map(w => mode === 'weekly' ? w.total : w.cumulative));
  const change = next => { setMode(next); setSelection(null); };
  const tip = item => mode === 'daily' ? `${item.date} · ${exact(item.total)} Token` : `${item.start} 至 ${item.end} · ${mode === 'weekly' ? '每周用量' : '累计用量'} ${exact(mode === 'weekly' ? item.total : item.cumulative)} Token`;
  const activate = (event, item) => {
    if (event.type !== 'keydown' || event.key === 'Enter' || event.key === ' ') {
      if (event.type === 'keydown') event.preventDefault();
      setSelection(tip(item));
    }
  };
  let month;
  const monthLabels = [];
  const columns = weeks.map((week, x) => {
    const anchor = week.cells.find(d => d.enabled)?.date;
    if (anchor?.slice(0, 7) !== month) {
      const previous = monthLabels.at(-1);
      if (!previous || x - previous.column >= 3) { monthLabels.push({ column: x, label: Number(anchor.slice(5, 7)) + '月' }); month = anchor.slice(0, 7); }
    }
    if (mode === 'daily') return week.cells.map((day, y) => {
      const level = !day.total ? 0 : Math.min(4, Math.max(1, Math.ceil(day.total / maxDay * 4)));
      return h('rect', { key: day.date, x: left + x * step, y: top + y * step, width: size, height: size, rx: 4,
        className: day.enabled ? `dtu-cell dtu-level-${level}` : 'dtu-cell-disabled',
        tabIndex: day.enabled ? 0 : undefined, role: day.enabled ? 'button' : undefined, 'aria-label': day.enabled ? tip(day) : undefined,
        onMouseEnter: day.enabled ? () => setSelection(tip(day)) : undefined, onFocus: day.enabled ? () => setSelection(tip(day)) : undefined,
        onClick: day.enabled ? event => activate(event, day) : undefined, onKeyDown: day.enabled ? event => activate(event, day) : undefined
      }, day.enabled ? h('title', null, tip(day)) : null);
    });
    const value = mode === 'weekly' ? week.total : week.cumulative;
    const amount = value > 0 ? Math.max(1, Math.ceil(value / maxColumn * 7)) : 0;
    return h('g', { key: x, tabIndex: 0, role: 'button', 'aria-label': tip(week), className: 'dtu-column',
      onMouseEnter: () => setSelection(tip(week)), onFocus: () => setSelection(tip(week)), onClick: event => activate(event, week), onKeyDown: event => activate(event, week) },
      h('title', null, tip(week)), Array.from({ length: 7 }, (_, y) => h('rect', { key: y, x: left + x * step, y: top + y * step, width: size, height: size, rx: 4, className: `dtu-cell ${6 - y < amount ? 'dtu-level-3' : 'dtu-level-0'}` })));
  });
  return h('section', { className: 'dtu-panel' },
    h('div', { className: 'dtu-section-head' }, h('h3', null, 'Token 活动'), h(Segments, { label: 'Token 活动视图', value: mode, options: [['daily', '每天'], ['weekly', '每周'], ['cumulative', '累计总量']], change })),
    h('div', { className: 'dtu-grid-scroll' }, h('svg', { className: 'dtu-heatmap', viewBox: `0 0 ${width} ${height}`, style: { minWidth: width / 1.4 }, 'aria-label': '最近一年 Token 活动', role: 'group' },
      [0, 2, 4, 6].map(y => h('text', { key: y, x: 0, y: top + y * step + 11, className: 'dtu-axis' }, ['一', '二', '三', '四', '五', '六', '日'][y])),
      columns, monthLabels.map(({ column, label }) => h('text', { key: column, x: left + column * step, y: 161, className: 'dtu-axis' }, label)))),
    h('div', { className: 'dtu-heat-footer' }, h('span', { className: 'dtu-tooltip', role: 'status', 'aria-live': 'polite' }, selection || '悬停或点击查看用量'),
      h('span', { className: 'dtu-scale' }, mode === 'daily' ? ['少', ...[0, 1, 2, 3, 4].map(n => h('i', { key: n, className: 'dtu-level-' + n })), '多'] : '柱高按当前图中最大用量缩放')),
    h('p', { className: 'dtu-note' }, `${yearStart(stats.today)} — ${stats.today} · 周一至周日${mode === 'cumulative' ? ' · 从图中第一周逐周累加' : ''}`));
}
function LineChart({ period, colors }) {
  const [active, setActive] = React.useState(null);
  React.useEffect(() => setActive(null), [period.start]);
  const width = 740, height = 260, left = 56, right = 16, top = 20, bottom = 35;
  const plotW = width - left - right, plotH = height - top - bottom;
  const peak = Math.max(1, ...period.days.flatMap(day => period.models.map(m => Object.hasOwn(day.models, m.id) ? day.models[m.id] : 0)));
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const max = Math.ceil(peak / magnitude / 2) * magnitude * 2;
  const x = i => left + i / (period.days.length - 1) * plotW;
  const y = value => top + plotH * (1 - value / max);
  const indexes = [...new Set([0, ...period.days.map((_, i) => i).filter(i => i % Math.ceil(period.days.length / 6) === 0), period.days.length - 1])];
  const activeDay = active === null ? null : period.days[active];
  return h(React.Fragment, null,
    h('svg', { className: 'dtu-line', viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': `近 ${period.days.length} 天各模型每日 Token 用量` },
      Array.from({ length: 5 }, (_, i) => h('g', { key: i }, h('line', { x1: left, x2: width - right, y1: y(max / 4 * i), y2: y(max / 4 * i), className: 'dtu-gridline' }), h('text', { x: left - 10, y: y(max / 4 * i) + 4, textAnchor: 'end', className: 'dtu-axis' }, short(max / 4 * i)))),
      indexes.map(i => h('text', { key: i, x: x(i), y: height - 10, textAnchor: i === 0 ? 'start' : i === period.days.length - 1 ? 'end' : 'middle', className: 'dtu-axis' }, period.days[i].date.slice(5).replace('-', '/'))),
      period.models.map(m => h('g', { key: m.id }, h('polyline', { fill: 'none', stroke: colors.get(m.id), strokeWidth: 2.5, strokeLinejoin: 'round', strokeLinecap: 'round', points: period.days.map((day, i) => `${x(i)},${y(Object.hasOwn(day.models, m.id) ? day.models[m.id] : 0)}`).join(' ') }),
        period.days.map((day, i) => h('circle', { key: i, cx: x(i), cy: y(Object.hasOwn(day.models, m.id) ? day.models[m.id] : 0), r: period.days.length === 7 || active === i ? 3.5 : 0, fill: colors.get(m.id) })))),
      active !== null ? h('line', { x1: x(active), x2: x(active), y1: top, y2: height - bottom, className: 'dtu-crosshair' }) : null,
      period.days.map((day, i) => h('rect', { key: i, x: x(i) - (i === 0 ? 0 : plotW / (period.days.length - 1) / 2), y: top, width: plotW / (period.days.length - 1) * (i === 0 || i === period.days.length - 1 ? .5 : 1), height: plotH, fill: 'transparent', tabIndex: 0, role: 'button', 'aria-label': `${day.date} · ${exact(day.total)} Token`, className: 'dtu-hit', onFocus: () => setActive(i), onMouseEnter: () => setActive(i), onClick: () => setActive(i), onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(i); } } }))),
    h('div', { className: 'dtu-line-tip', role: 'status' }, activeDay ? [h('strong', { key: 'date' }, activeDay.date), ...period.models.map(m => h('span', { key: m.id }, h('i', { className: 'dtu-dot', style: { background: colors.get(m.id) } }), `${m.id}  ${exact(Object.hasOwn(activeDay.models, m.id) ? activeDay.models[m.id] : 0)}`))] : '悬停、点击或使用 Tab 查看每日各模型用量'),
    period.models.length === 0 ? h('p', { className: 'dtu-empty' }, '这段时间暂无用量') : null);
}
function PieChart({ period, colors }) {
  const [selected, setSelected] = React.useState(null);
  React.useEffect(() => setSelected(null), [period.start]);
  let angle = -Math.PI / 2;
  const cx = 100, cy = 100, radius = 86;
  const point = a => [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  const arcs = period.models.map(model => {
    const fraction = model.total / period.total, end = angle + fraction * Math.PI * 2;
    const [sx, sy] = point(angle), [ex, ey] = point(end);
    const text = `${model.id} · ${exact(model.total)} Token · ${(fraction * 100).toFixed(1)}%`;
    const props = { fill: colors.get(model.id), stroke: 'var(--dtu-bg)', strokeWidth: 2, className: 'dtu-slice', tabIndex: 0, role: 'button', 'aria-label': text,
      onMouseEnter: () => setSelected(text), onFocus: () => setSelected(text), onClick: () => setSelected(text), onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(text); } } };
    const slice = fraction > .999999 ? h('circle', { ...props, key: model.id, cx, cy, r: radius }, h('title', null, text)) : h('path', { ...props, key: model.id, d: `M${cx},${cy} L${sx},${sy} A${radius},${radius} 0 ${fraction > .5 ? 1 : 0},1 ${ex},${ey} Z` }, h('title', null, text));
    angle = end;
    return slice;
  });
  return h('div', null,
    h('div', { className: 'dtu-pie-layout' }, h('div', { className: 'dtu-pie-visual' }, h('svg', { viewBox: '0 0 200 200', className: 'dtu-pie', role: 'group', 'aria-label': `近 ${period.days.length} 天模型用量占比` }, period.total ? arcs : h('circle', { cx, cy, r: radius, className: 'dtu-pie-empty' })), h('div', { className: 'dtu-period-total' }, h('strong', null, short(period.total)), h('span', null, '区间总用量'))),
      h(ModelTable, { models: period.models, colors, total: period.total, caption: '区间内各模型用量与占比' })),
    h('div', { className: 'dtu-pie-tip', role: 'status' }, selected || (period.total ? '悬停或点击扇区查看精确用量' : '暂无用量记录')));
}
function UsagePanel() {
  const [stats, setStats] = React.useState(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(true);
  const [periodLength, setPeriodLength] = React.useState(7), [detail, setDetail] = React.useState(null);
  const mounted = React.useRef(true), running = React.useRef(false);
  const load = React.useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const response = await fetch('/dsh-token-usage/stats', { credentials: 'same-origin', cache: 'no-store' });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || '读取失败');
      if (!Array.isArray(next.days) || !Array.isArray(next.models)) throw new Error('统计数据格式不正确');
      if (mounted.current) { setStats(next); setError(''); }
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }, []);
  React.useEffect(() => {
    mounted.current = true;
    load();
    const refresh = () => { if (document.visibilityState === 'visible') load(); };
    const timer = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [load]);
  const colors = React.useMemo(() => colorsFor(stats?.models || []), [stats?.models]);
  const period = React.useMemo(() => stats ? periodData(stats, periodLength) : null, [stats, periodLength]);
  const peakModels = stats?.peak ? Object.entries(stats.peak.models).map(([id, total]) => ({ id, total })).sort((a, b) => b.total - a.total) : [];
  const card = (id, label, value, note) => h('button', { type: 'button', className: 'dtu-summary-card', 'aria-expanded': detail === id, 'aria-controls': 'dtu-detail', onClick: () => setDetail(detail === id ? null : id) },
    h('span', { className: 'dtu-card-label' }, label, h('span', { className: 'dtu-detail-link' }, '详情 ↗')), h('strong', { className: 'dtu-card-value', title: exact(value) + ' Token' }, short(value)), h('span', { className: 'dtu-card-note' }, note));
  return h('div', { className: 'dtu-root' }, h('style', null, CSS),
    h('div', { className: 'dtu-page-head' }, h('div', null, h('h2', null, 'Token 用量'), h('p', null, '每一次调用，都有迹可循。')), h('button', { type: 'button', className: 'dtu-refresh', disabled: busy, onClick: load }, busy ? '更新中…' : '刷新')),
    error ? h('div', { className: 'dtu-error', role: 'alert' }, error, ' ', h('button', { type: 'button', onClick: load, disabled: busy }, '重试')) : null,
    !stats ? h('p', { className: 'dtu-loading', role: 'status' }, busy ? '正在整理历史用量…' : '暂时无法读取用量') : h(React.Fragment, null,
      h('div', { className: 'dtu-summary' }, card('total', '总用量', stats.total, '全部历史 · Token'), card('peak', '日峰值用量', stats.peak?.total || 0, stats.peak?.date || '暂无峰值记录'),
        h('div', { className: 'dtu-summary-card dtu-model-card' }, h('span', { className: 'dtu-card-label' }, '最常用的模型'), h('strong', { className: 'dtu-model-name', title: stats.models[0]?.id }, stats.models[0]?.id || '暂无记录'), h('span', { className: 'dtu-card-note' }, stats.models[0] ? `${exact(stats.models[0].total)} Token · 全部历史` : '按累计消耗量统计'))),
      detail ? h('section', { className: 'dtu-panel dtu-details', id: 'dtu-detail' }, h('div', { className: 'dtu-section-head' }, h('h3', null, detail === 'total' ? '总用量明细' : `日峰值明细${stats.peak ? ' · ' + stats.peak.date : ''}`), h('button', { type: 'button', onClick: () => setDetail(null), className: 'dtu-close', 'aria-label': '关闭用量明细' }, '收起')),
        h('p', { className: 'dtu-detail-number' }, exact(detail === 'total' ? stats.total : stats.peak?.total || 0), h('span', null, ' Token')),
        h(ModelTable, { models: detail === 'total' ? stats.models : peakModels, colors, total: detail === 'total' ? stats.total : stats.peak?.total || 0, caption: detail === 'total' ? '每个模型的全部历史累计用量' : '峰值当日每个模型的用量' })) : null,
      h(Heatmap, { stats }),
      h('section', { className: 'dtu-panel' }, h('div', { className: 'dtu-section-head' }, h('div', null, h('h3', null, '模型用量趋势'), h('p', { className: 'dtu-subtitle' }, `${period.start} — ${stats.today} · 每日 Token`)), h(Segments, { label: '模型用量统计周期', value: periodLength, options: [[7, '近 7 天'], [30, '近 30 天']], change: setPeriodLength })),
        h('div', { className: 'dtu-legend' }, period.models.map(m => h('span', { key: m.id }, h('i', { className: 'dtu-dot', style: { background: colors.get(m.id) } }), m.id))), h(LineChart, { period, colors })),
      h('section', { className: 'dtu-panel' }, h('div', { className: 'dtu-section-head' }, h('h3', null, '模型用量占比'), h('span', { className: 'dtu-subtitle' }, `近 ${periodLength} 天 · 与趋势图同步`)), h(PieChart, { period, colors })),
      stats.warnings?.length ? h('p', { className: 'dtu-warning', role: 'status' }, stats.warnings.join(' ')) : null,
      h('p', { className: 'dtu-footnote' }, `输入 + 输出总 Token，包含缓存命中与推理，不重复计算。按 ${stats.timeZone} 日期归档。`, h('br'), `统计来自本机保存的服务商用量记录；${stats.missingUsage ? `${exact(stats.missingUsage)} 次调用未返回用量，未计入。` : '未返回用量的调用不作估算。'}历史已删除且未被记录的用量无法恢复。`)));
}
function apply(ctx) {
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'token-usage', order: 13, label: () => 'Token 用量', inject: () => ({}) }, UsagePanel));
}

return {inject:['slots'],apply};
}});
