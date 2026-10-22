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
