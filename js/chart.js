/* hakari — графіки
 *
 * SVG пишемо руками: жодних бібліотек, повний офлайн, повний контроль
 * над тим, щоб лінія виглядала як штрих тушшю, а не як діловий звіт.
 * Без рамок, без сітки, без легенди — тільки сама лінія й дві дати.
 */

import { fmtShort, fmtKg, daysBetween } from './calc.js';

const NS = 'http://www.w3.org/2000/svg';

const W = 340, H = 182;
const PAD = { t: 18, r: 2, b: 30, l: 2 };
const BOTTOM = H - PAD.b;          // низ поля графіка
const PHOTO_Y = BOTTOM + 6;        // смужка позначок фото між лінією й датами

const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

/* Шари мазка тренду, як у енсо: кожен наступний товщий і коротший.
   Штрих входить густо й сходить нанівець — лінія читається як один
   рух пензля, а не як плотерна крива. f — частка довжини від початку. */
const BRUSH = [
  { cls: 'chart__trend',                       f: 1 },
  { cls: 'chart__trend chart__trend--mid',     f: .7 },
  { cls: 'chart__trend chart__trend--wet',     f: .35 },
];

/**
 * Один графік на дві величини — вагу й жир. Точки не мусять іти щодня:
 * x рахується від дати, тож тижневі обміри лягають на свої місця.
 *
 * @param {SVGElement} svg     порожній <svg class="chart">
 * @param {Array<{date, raw: number|null, trend: number, gap: boolean}>} series
 *        raw — сирий вимір (null, якщо того дня не було), gap — відрізок,
 *        що веде до цієї точки, пройшов крізь пропуск
 * @param {object} opts
 *        fmt      — як підписати значення
 *        unit     — одиниця в підказці по тапу (' кг'; у жиру вже є «%»)
 *        empty    — текст, поки точок замало
 *        rawMark  — 'dot' для щоденних зважувань, 'enso' для рідких обмірів
 *        photos   — [{date, id}] позначки фото під лінією
 *        onPhoto  — тап по позначці фото
 */
export function renderChart(svg, series, {
  fmt = fmtKg, unit = '', empty = 'ще замало записів',
  rawMark = 'dot', photos = [], onPhoto = null,
} = {}) {
  svg.textContent = '';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.classList.remove('is-probing');
  svg.onclick = null;

  if (series.length < 2) {
    svg.appendChild(text(W / 2, H / 2, empty, { 'text-anchor': 'middle' }));
    return;
  }

  /* — вертикальний масштаб —
     Тільки по реальних даних. Цільової ваги в застосунку більше немає,
     але правило лишається: будь-яке зовнішнє число, втягнуте в шкалу,
     сплющує тренд у вузьку смужку — саме те, через що здається, ніби
     нічого не відбувається. */
  const vals = [];
  for (const p of series) {
    vals.push(p.trend);
    if (p.raw != null) vals.push(p.raw);
  }

  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  lo -= span * 0.12;
  hi += span * 0.12;

  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const first = series[0].date, last = series[series.length - 1].date;
  const spanDays = daysBetween(first, last) || 1;
  const xDate = d => PAD.l + (daysBetween(first, d) / spanDays) * plotW;
  const x = i => xDate(series[i].date);
  const y = v => PAD.t + (1 - (v - lo) / (hi - lo)) * plotH;

  /* — домальовування —
     Лінія й точки з'являються зліва направо, як мазок, — та сама
     мова, що в енсо. Маска-прямокутник росте по ширині; запускає
     її playChart(), коли екран справді видно (див. app.js). */
  const clip = el('clipPath', { id: 'chart-reveal' });
  const rect = el('rect', { x: 0, y: -10, width: W, height: H + 20 });
  rect.appendChild(el('animate', {
    attributeName: 'width', from: 0, to: W, dur: '.9s', begin: 'indefinite', fill: 'freeze',
    calcMode: 'spline', keyTimes: '0;1', keySplines: '.22 .61 .36 1',
  }));
  clip.appendChild(rect);
  const defs = el('defs');
  defs.appendChild(clip);
  svg.appendChild(defs);

  const ink = el('g', { 'clip-path': 'url(#chart-reveal)' });
  svg.appendChild(ink);

  /* — сирі виміри —
     Щоденні зважування — ледь помітні кола. Обміри рідкі, тому кожен
     — крихітне незамкнене енсо: та сама форма, що головне кільце, і
     відразу видно, що це інший ритм, ніж вага. */
  series.forEach((p, i) => {
    if (p.raw == null) return;
    ink.appendChild(rawMark === 'enso'
      ? el('path', { class: 'chart__raw chart__raw--enso', d: ensoArc(x(i), y(p.raw), 2.8) })
      : el('circle', { class: 'chart__raw', cx: x(i), cy: y(p.raw), r: 1.9, 'stroke-width': 1 }));
  });

  /* — тренд: штрих тушшю, а в дні без вимірів — золота тріщина —
     EMA в пропущений день не рухається, тобто лінія там рівна
     горизонталь. Малювати її тією ж тушшю означає вдавати, що дані
     є; календар-кінцугі про той самий пропуск каже чесніше, і тут
     має бути та сама мова. */
  const pts = series.map((p, i) => [x(i), y(p.trend)]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const L = cum[cum.length - 1] || 1;

  for (const seg of splitGaps(series)) {
    const d = seg.pts.map((i, k) => `${k ? 'L' : 'M'}${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`).join(' ');
    if (seg.gap) {
      ink.appendChild(el('path', { class: 'chart__trend chart__trend--gap', d }));
      continue;
    }
    /* Кожен шар мазка — той самий шлях, обрізаний штрихуванням до
       своєї частки загальної довжини. Відрізки між тріщинами беруть
       свою ділянку від спільного мазка, тож звуження йде через увесь
       графік, а не починається наново після кожного пропуску. */
    const s = cum[seg.pts[0]], e = cum[seg.pts[seg.pts.length - 1]];
    for (const layer of BRUSH) {
      const upto = Math.min(e, L * layer.f) - s;
      if (upto < 0.5) continue;
      const attrs = { class: layer.cls, d };
      if (upto < e - s - 0.01) attrs['stroke-dasharray'] = `${upto.toFixed(1)} ${(L * 2).toFixed(0)}`;
      ink.appendChild(el('path', attrs));
    }
  }

  /* — межі шкали: дві цифри, більше нічого — */
  const realHi = Math.max(...series.map(p => p.trend));
  const realLo = Math.min(...series.map(p => p.trend));
  svg.appendChild(text(PAD.l, y(realHi) - 8, fmt(realHi)));
  svg.appendChild(text(PAD.l, y(realLo) + 14, fmt(realLo)));

  /* — дати: тільки початок і кінець — */
  svg.appendChild(text(PAD.l, H - 8, fmtShort(first), { class: 'chart__tick chart__tick--date' }));
  svg.appendChild(text(W - PAD.r, H - 8, fmtShort(last), { 'text-anchor': 'end', class: 'chart__tick chart__tick--date' }));

  /* — фото: крихітні рамки під лінією, в дні, коли знімали —
     Два тижневі ритуали поруч: «−1.7%» і фото того самого дня
     переконують сильніше, ніж окремо. Тап відкриває знімок. */
  const marks = [];
  const byDate = new Map();
  for (const ph of photos) if (ph.date >= first && ph.date <= last) byDate.set(ph.date, ph.id);
  for (const [date, id] of byDate) {
    const mx = xDate(date);
    marks.push({ x: mx, id });
    svg.appendChild(el('rect', { class: 'chart__photo', x: (mx - 2).toFixed(1), y: PHOTO_Y, width: 4, height: 5.5, rx: .6 }));
  }

  /* — тап: що було того дня —
     Тап по графіку показує найближчий вимір: дату, сире число й тренд.
     Дати внизу на цей час ховаються — підказка стає на їхнє місце, а не
     лягає поверх лінії. Повторний тап по тій самій точці ховає. */
  let probed = null;
  svg.onclick = ev => {
    const box = svg.getBoundingClientRect();
    const k = W / box.width;
    const vx = (ev.clientX - box.left) * k;
    const vy = (ev.clientY - box.top) * k;

    if (onPhoto && marks.length && vy > BOTTOM - 2 && vy < H - 16) {
      const hit = nearest(marks, m => m.x, vx, 12);
      if (hit) { onPhoto(hit.id); return; }
    }

    const cands = [];
    series.forEach((p, i) => { if (p.raw != null) cands.push({ i, x: x(i) }); });
    const hit = nearest(cands, c => c.x, vx, 40);   // обміри стоять рідко — палець не мусить влучати точно
    svg.querySelector('.chart__probe')?.remove();
    if (!hit || hit.i === probed) {
      probed = null;
      svg.classList.remove('is-probing');
      return;
    }
    probed = hit.i;
    const p = series[hit.i];
    const g = el('g', { class: 'chart__probe' });
    g.appendChild(el('line', { class: 'chart__probe-line', x1: hit.x, x2: hit.x, y1: PAD.t - 6, y2: BOTTOM }));
    g.appendChild(el('circle', { class: 'chart__probe-dot', cx: hit.x, cy: y(p.raw), r: 2.6 }));
    g.appendChild(text(W / 2, H - 8,
      `${fmtShort(p.date)} · ${fmt(p.raw)}${unit} · тренд ${fmt(p.trend)}${unit}`,
      { 'text-anchor': 'middle' }));
    svg.appendChild(g);
    svg.classList.add('is-probing');
  };
}

/** Запускає домальовування. Без «зменшення руху» — і лише коли екран видно. */
export function playChart(svg) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const a = svg.querySelector('#chart-reveal animate');
  if (a && typeof a.beginElement === 'function') a.beginElement();
}

function nearest(items, getX, vx, within) {
  let best = null, bestD = within;
  for (const it of items) {
    const d = Math.abs(getX(it) - vx);
    if (d <= bestD) { best = it; bestD = d; }
  }
  return best;
}

/* Незамкнене коло: починається згори й іде за годинниковою стрілкою
   на ту саму частку, що й головне енсо (SWEEP), лишаючи просвіт. */
function ensoArc(cx, cy, r) {
  const a = -Math.PI / 2 + SWEEP * 2 * Math.PI;
  const ex = cx + r * Math.cos(a), ey = cy + r * Math.sin(a);
  return `M${cx.toFixed(1)} ${(cy - r).toFixed(1)} A${r} ${r} 0 1 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`;
}

/**
 * Ділить ряд на відрізки «є виміри» / «пропуск». Лінія не рветься:
 * кожен новий відрізок починається з останньої точки попереднього.
 */
function splitGaps(series) {
  const out = [];
  for (let i = 1; i < series.length; i++) {
    const gap = series[i].gap;
    const last = out[out.length - 1];
    if (last && last.gap === gap) last.pts.push(i);
    else out.push({ gap, pts: [i - 1, i] });
  }
  return out;
}

function text(x, y, str, attrs = {}) {
  const t = el('text', { class: 'chart__tick', x, y, ...attrs });
  t.textContent = str;
  return t;
}

/* ── енсо ────────────────────────────────────────────────
 * Коло консистентності. Навмисно незамкнене: енсо ніколи не
 * домальовують до кінця, і 100% тут не мета.
 */

const SWEEP = 0.88;   // частка кола, яку взагалі можна заповнити

/**
 * Кільце консистентності. Шарів мазка кілька: кожен зі своїм data-len,
 * коротші — товщі, тому штрих звужується до кінця, як пензель.
 * @param {HTMLElement} wrap  контейнер з дугами .enso__arc
 */
export function renderEnso(wrap, ratio) {
  const arcs = wrap.querySelectorAll('.enso__arc');
  const r = Number(arcs[0].getAttribute('r'));
  const C = 2 * Math.PI * r;
  const len = Math.max(0, Math.min(1, ratio)) * SWEEP * C;

  for (const arc of arcs) paint(arc, C, len * Number(arc.dataset.len));
}

/* Довжина задається зсувом, а не самим штрихом: dasharray лишається
   незмінним, бо його браузер не інтерполює — раніше transition у CSS
   стояв на dashoffset, а мінявся dasharray, і кільце не домальовувалось,
   а виникало миттєво. */
function paint(circle, C, len) {
  // нульова дуга з круглим наконечником малюється як крапка — ховаємо її
  circle.style.opacity = len < 0.5 ? '0' : '';
  circle.setAttribute('stroke-dasharray', `${C.toFixed(2)} ${C.toFixed(2)}`);
  circle.setAttribute('stroke-dashoffset', (C - len).toFixed(2));
}
