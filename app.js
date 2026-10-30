(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const DAY = 864e5;
  const GAP_DAYS = { nbs: 48 };
  const DEFAULT_GAP = 35;
  const $ = (s) => document.querySelector(s);
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const mobile = window.matchMedia('(max-width: 760px)');

  const state = { data: null, range: '184', hidden: new Set(), pinned: null };

  const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const parts = (iso) => iso.split('-').map(Number);
  function period(s, e) {
    const [ys, ms, ds] = parts(s), [ye, me, de] = parts(e);
    if (ys !== ye) return `${ys}.${ms}.${ds}~${ye}.${me}.${de}`;
    if (ms !== me) return `${ys}.${ms}.${ds}~${me}.${de}`;
    return `${ys}.${ms}.${ds}~${de}`;
  }
  const fmtDate = (iso) => { const [y, m, d] = parts(iso); return `${y}.${m}.${d}`; };
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const srcLabel = { primary: '조사기관 원자료', nesdc: '여심위 등록 결과표', news: '의뢰 언론사 보도' };

  function decimals(pid) {
    return state.data.polls.some((p) => p.pollster === pid && !Number.isInteger(p.approve)) ? 1 : 0;
  }
  const fmt = (v, pid) => v.toFixed(decimals(pid));
  const color = (p) => (dark.matches ? p.colorDark : p.color);
  const series = (pid) => state.data.polls.filter((p) => p.pollster === pid).sort((a, b) => a.start.localeCompare(b.start));
  const pollsterById = (id) => state.data.pollsters.find((p) => p.id === id);
  // short label for running text / chart end labels; optional `short` overrides the name minus its parenthetical
  const short = (ps) => ps.short || ps.name.replace(/\(.*\)/, '').trim();
  const dashed = (ps) => ps.line === 'dashed';

  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }

  /* ---------- latest strip ---------- */
  function renderLatest() {
    const box = $('#latest');
    box.innerHTML = '';
    for (const ps of state.data.pollsters) {
      const s = series(ps.id);
      if (!s.length) continue;
      const last = s[s.length - 1], prev = s[s.length - 2];
      const dp = decimals(ps.id);
      let chg = '', cls = '';
      if (prev) {
        const d = Number((last.approve - prev.approve).toFixed(dp));
        if (d === 0) chg = '±0%p';
        else if (d > 0) { chg = `+${d.toFixed(dp)}%p`; cls = 'up'; }
        else { chg = `-${Math.abs(d).toFixed(dp)}%p`; cls = 'down'; }
      }
      const a = document.createElement('article');
      a.innerHTML = `
        <div class="l-name"><i style="color:${color(ps)}">●</i>${esc(ps.name)}</div>
        <div class="l-main"><span class="l-num">${fmt(last.approve, ps.id)}%</span><span class="l-chg ${cls}">${chg}</span></div>
        <div class="l-when">${period(last.start, last.end)}${prev ? ' · 직전 조사 대비' : ''}</div>
        <div class="l-meta">n=${last.n.toLocaleString('ko-KR')} · ${esc(last.method)} · 95% 신뢰수준 ±${last.moe.toFixed(1)}%p · <a href="${esc(last.sourceUrl)}" target="_blank" rel="noopener">출처 ↗</a></div>`;
      box.appendChild(a);
    }
  }

  /* ---------- legend ---------- */
  function renderLegend() {
    const box = $('#legend');
    box.innerHTML = '';
    for (const ps of state.data.pollsters) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill' + (state.hidden.has(ps.id) ? ' off' : '');
      b.setAttribute('aria-pressed', String(!state.hidden.has(ps.id)));
      b.innerHTML = `<span class="sw${dashed(ps) ? ' dashed' : ''}" style="color:${color(ps)}"></span>${esc(ps.name)}`;
      b.addEventListener('click', () => {
        if (state.hidden.has(ps.id)) state.hidden.delete(ps.id);
        else if (state.data.pollsters.length - state.hidden.size > 1) state.hidden.add(ps.id);
        hideTip(true);
        renderLegend();
        renderChart();
      });
      box.appendChild(b);
    }
  }

  /* ---------- chart ---------- */
  function renderChart() {
    const svg = $('#svg');
    const isMobile = mobile.matches;
    // keep strokes/text/margins at a constant on-screen size when the SVG is scaled down (mobile)
    const px = Math.max(1, 1000 / (svg.clientWidth || 1000));
    const W = 1000, H = isMobile ? Math.round(1000 * 0.86) : 470;
    const M = { top: 26 * px, right: (isMobile ? 24 : 88) * px, bottom: 54 * px, left: 52 * px };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    while (svg.lastChild && svg.lastChild.nodeName !== 'title') svg.removeChild(svg.lastChild);

    const all = state.data.polls;
    const maxT = Math.max(...all.map((p) => parse(p.start)));
    const minAll = Math.min(...all.map((p) => parse(p.start)));
    const t0 = state.range === 'all' ? minAll : maxT - Number(state.range) * DAY;
    const t1 = maxT;
    const visible = state.data.pollsters.filter((p) => !state.hidden.has(p.id));
    const pts = {};
    for (const ps of visible) pts[ps.id] = series(ps.id).filter((p) => parse(p.start) >= t0);
    const vals = Object.values(pts).flat().map((p) => p.approve);
    const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 100;
    const y0 = Math.max(0, Math.floor((lo - 4) / 5) * 5), y1 = Math.min(100, Math.ceil((hi + 4) / 5) * 5);
    const span = Math.max(1, t1 - t0);
    const X = (t) => M.left + ((t - t0) / span) * (W - M.left - M.right);
    const Y = (v) => M.top + (1 - (v - y0) / (y1 - y0)) * (H - M.top - M.bottom);
    const css = getComputedStyle(document.documentElement);
    const C = (n) => css.getPropertyValue(n).trim();

    // grid + y labels
    const g = el('g', {}, svg);
    for (let v = Math.ceil(y0 / 10) * 10; v <= y1; v += 10) {
      el('line', { x1: M.left, x2: W - M.right, y1: Y(v), y2: Y(v), stroke: C('--grid'), 'stroke-width': 1 * px }, g);
      const t = el('text', { x: M.left - 10 * px, y: Y(v), 'text-anchor': 'end', 'dominant-baseline': 'middle', fill: C('--quiet'), 'font-size': 12 * px }, g);
      t.textContent = v;
    }
    el('line', { x1: M.left, x2: W - M.right, y1: H - M.bottom, y2: H - M.bottom, stroke: C('--rule'), 'stroke-width': 1 * px }, g);
    // x ticks
    const nT = isMobile ? 4 : 7;
    for (let i = 0; i < nT; i++) {
      const t = t0 + (span * i) / (nT - 1);
      const d = new Date(t);
      const x = X(t);
      el('line', { x1: x, x2: x, y1: H - M.bottom, y2: H - M.bottom + 6 * px, stroke: C('--rule'), 'stroke-width': 1 * px }, g);
      const lab = el('text', { x, y: H - M.bottom + 22 * px, 'text-anchor': i === 0 ? 'start' : i === nT - 1 ? 'end' : 'middle', fill: C('--quiet'), 'font-size': 12 * px }, g);
      lab.textContent = `${String(d.getUTCFullYear()).slice(2)}.${d.getUTCMonth() + 1}`;
    }

    // lines
    const ends = [];
    for (const ps of visible) {
      const s = pts[ps.id];
      if (!s.length) continue;
      const col = color(ps), gap = (GAP_DAYS[ps.id] || DEFAULT_GAP) * DAY;
      let d = '';
      s.forEach((p, i) => {
        const cmd = i === 0 || parse(p.start) - parse(s[i - 1].start) > gap ? 'M' : 'L';
        d += `${cmd}${X(parse(p.start)).toFixed(1)},${Y(p.approve).toFixed(1)}`;
      });
      const line = { d, fill: 'none', stroke: col, 'stroke-width': 3.3 * px, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
      if (dashed(ps)) line['stroke-dasharray'] = `${1.5 * px} ${6.5 * px}`; // round caps turn short dashes into a dotted-dash line
      el('path', line, svg);
      const last = s[s.length - 1];
      ends.push({ ps, x: X(parse(last.start)), y: Y(last.approve), v: last.approve, col });
    }
    // dots
    const dpx = Math.min(px, 1.7); // dots stay slightly smaller on narrow screens so dense series remain readable
    const dg = el('g', {}, svg);
    for (const ps of visible) {
      for (const p of pts[ps.id]) {
        const c = el('circle', {
          class: 'dot', cx: X(parse(p.start)), cy: Y(p.approve), r: (dashed(ps) ? 4.6 : 5.6) * dpx,
          // dashed-line series get hollow dots so the paired series stay distinguishable where they overlap
          fill: dashed(ps) ? C('--surface') : color(ps), stroke: dashed(ps) ? color(ps) : C('--surface'),
          'stroke-width': (dashed(ps) ? 2.4 : 2.5) * dpx, tabindex: 0, role: 'button',
          'aria-label': `${ps.name} ${period(p.start, p.end)} ${fmt(p.approve, ps.id)}%`
        }, dg);
        c.addEventListener('mouseenter', () => { if (!state.pinned) showTip(p, c); });
        c.addEventListener('mouseleave', () => { if (!state.pinned) hideTip(); });
        c.addEventListener('focus', () => showTip(p, c));
        c.addEventListener('blur', () => { if (state.pinned !== p) hideTip(); });
        c.addEventListener('click', (e) => { e.stopPropagation(); state.pinned = p; showTip(p, c, true); });
        c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.pinned = p; showTip(p, c, true); } if (e.key === 'Escape') hideTip(true); });
      }
    }
    // end labels (desktop only), nudged apart to avoid overlap
    if (!isMobile && ends.length) {
      ends.sort((a, b) => a.y - b.y);
      const minGap = 17 * px;
      const ly = ends.map((e) => e.y);
      for (let i = 1; i < ly.length; i++) if (ly[i] - ly[i - 1] < minGap) ly[i] = ly[i - 1] + minGap;
      const over = ly[ly.length - 1] - (H - M.bottom);
      if (over > 0) for (let i = 0; i < ly.length; i++) ly[i] -= over;
      ends.forEach((e, i) => {
        const t = el('text', { x: e.x + 12 * px, y: ly[i], 'dominant-baseline': 'middle', fill: e.col, 'font-size': 12 * px, 'font-weight': 800 }, svg);
        t.textContent = `${short(e.ps)} ${fmt(e.v, e.ps.id)}`;
      });
    }
  }

  /* ---------- tooltip ---------- */
  function showTip(p, node, pin = false) {
    const tip = $('#tip'), ps = pollsterById(p.pollster);
    tip.innerHTML = `<b style="color:${color(ps)}">${esc(ps.name)}</b>
      <span class="v">${fmt(p.approve, ps.id)}%</span>
      <div class="p">${period(p.start, p.end)}${p.disapprove != null ? ` · 부정 ${fmt(p.disapprove, ps.id)}%` : ''}</div>
      <div class="m">n=${p.n.toLocaleString('ko-KR')} · ${esc(p.method)} · ±${p.moe.toFixed(1)}%p<br>
      <a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">${srcLabel[p.sourceType] || '출처'} ↗</a></div>`;
    tip.hidden = false;
    tip.classList.toggle('pinned', pin);
    const box = $('#chart').getBoundingClientRect(), r = node.getBoundingClientRect();
    const cx = r.left + r.width / 2 - box.left, cy = r.top - box.top;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = cx + 14, top = cy - th - 10;
    if (left + tw > box.width) left = cx - tw - 14;
    if (left < 0) left = Math.max(0, Math.min(box.width - tw, cx - tw / 2));
    if (top < 0) top = cy + r.height + 12;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  function hideTip(force) {
    if (force) state.pinned = null;
    const tip = $('#tip');
    tip.hidden = true;
    tip.classList.remove('pinned');
  }

  /* ---------- notes ---------- */
  function renderNotes() {
    const L = state.data.pollsters.map((ps) => {
      const s = series(ps.id);
      return { ps, last: s[s.length - 1], first: s[0], peak: s.reduce((a, b) => (b.approve > a.approve ? b : a)), n: s.length };
    });
    const latest = L.map((o) => `${o.ps.name} ${fmt(o.last.approve, o.ps.id)}%(${period(o.last.start, o.last.end).replace(/^\d{4}\./, '')})`).join(', ');
    const peaks = L.map((o) => `${short(o.ps)} ${fmt(o.peak.approve, o.ps.id)}%(${fmtDate(o.peak.start)})`).join(', ');
    const lo = L.reduce((a, b) => (b.last.approve < a.last.approve ? b : a)), hi = L.reduce((a, b) => (b.last.approve > a.last.approve ? b : a));
    $('#howto').textContent =
      `각 점은 조사 시작일 위치에 찍은 해당 조사의 긍정평가(‘잘하고 있다’) 비율입니다. ` +
      `가장 최근 조사는 ${latest}이며, 기관 간 차이는 ${(hi.last.approve - lo.last.approve).toFixed(1).replace(/\.0$/, '')}%p입니다. ` +
      `기록된 기간 중 최고치는 ${peaks}였습니다. ` +
      `리얼미터는 무선 ARS 자동응답, 한국갤럽·NBS는 전화면접 방식이라 같은 시기에도 수준이 다를 수 있으므로 기관 간 절대값보다 각 선의 방향을 비교해 읽는 것이 좋습니다. ` +
      `여론조사꽃은 같은 이틀 동안 전화면접(실선)과 ARS(점선)를 따로 실시해 두 결과를 함께 발표하므로, 두 선의 간격은 조사 방식에 따른 차이를 보여 줍니다(두 값을 평균하지 않습니다). ` +
      `총 ${L.reduce((a, o) => a + o.n, 0)}개 조사(${L.map((o) => `${short(o.ps)} ${o.n}`).join(' · ')})를 표시합니다.`;
    const ul = $('#sources');
    ul.innerHTML = '';
    for (const o of L) {
      const li = document.createElement('li');
      li.innerHTML = `<a href="${esc(o.last.sourceUrl)}" target="_blank" rel="noopener">${esc(short(o.ps))} 최신 결과 ↗</a>
        <small>${period(o.last.start, o.last.end)} · ${srcLabel[o.last.sourceType]}${o.last.nesdcId ? ` · 여심위 등록 ${esc(o.last.nesdcId)}` : ''} · <a href="${esc(o.ps.sourceHome)}" target="_blank" rel="noopener">발표 목록</a></small>`;
      ul.appendChild(li);
    }
  }

  /* ---------- wiring ---------- */
  function renderAll() { renderLatest(); renderLegend(); renderChart(); }

  document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    state.range = b.dataset.range;
    document.querySelectorAll('[data-range]').forEach((x) => {
      const on = x === b;
      x.classList.toggle('is-active', on);
      x.setAttribute('aria-pressed', String(on));
    });
    hideTip(true);
    renderChart();
  }));
  document.addEventListener('click', (e) => { if (!$('#tip').contains(e.target)) hideTip(true); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(true); });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { hideTip(true); renderChart(); }, 120); });
  const onScheme = () => { hideTip(true); renderAll(); };
  (dark.addEventListener ? dark.addEventListener('change', onScheme) : dark.addListener(onScheme));

  fetch('data/polls.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((d) => {
      state.data = d;
      $('#stamp-date').textContent = fmtDate(d.updated);
      renderAll();
      renderNotes();
    })
    .catch((err) => {
      $('#howto').textContent = `데이터를 불러오지 못했습니다 (${err.message}).`;
    });
})();
