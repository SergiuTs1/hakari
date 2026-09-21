/* hakari — графіки
 *
 * SVG пишемо руками: жодних бібліотек, повний офлайн, повний контроль
 * над тим, щоб лінія виглядала як штрих тушшю, а не як діловий звіт.
 * Без рамок, без сітки, без легенди — тільки сама лінія й дві дати.
 */

import { fmtShort, fmtKg } from './calc.js';

const NS = 'http://www.w3.org/2000/svg';

const W = 340, H = 182;
const PAD = { t: 18, r: 2, b: 30, l: 2 };

const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

/**
 * @param {SVGElement} svg     порожній <svg class="chart">
 * @param {Array}      series  результат buildSeries()
 */
export function renderChart(svg, series) {
  svg.textContent = '';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  if (series.length < 2) {
    svg.appendChild(text(W / 2, H / 2, 'ще замало записів', { 'text-anchor': 'middle' }));
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
    if (p.weight != null) vals.push(p.weight);
  }

  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  lo -= span * 0.12;
  hi += span * 0.12;

  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = i => PAD.l + (i / (series.length - 1)) * plotW;
  const y = v => PAD.t + (1 - (v - lo) / (hi - lo)) * plotH;

  /* — сирі зважування: ледь помітні порожні кола — */
  series.forEach((p, i) => {
    if (p.weight == null) return;
    svg.appendChild(el('circle', { class: 'chart__raw', cx: x(i), cy: y(p.weight), r: 1.9, 'stroke-width': 1 }));
  });

  /* — тренд: штрих тушшю, а в дні без зважування — золота тріщина —
     EMA в пропущений день не рухається, тобто лінія там рівна
     горизонталь. Малювати її тією ж тушшю означає вдавати, що дані
     є; календар-кінцугі про той самий пропуск каже чесніше, і тут
     має бути та сама мова. */
  for (const seg of splitGaps(series)) {
    svg.appendChild(el('path', {
      class: seg.gap ? 'chart__trend chart__trend--gap' : 'chart__trend',
      d: seg.pts.map((i, k) =>
        `${k ? 'L' : 'M'}${x(i).toFixed(1)} ${y(series[i].trend).toFixed(1)}`).join(' '),
    }));
  }

  /* — межі шкали: дві цифри, більше нічого — */
  const realHi = Math.max(...series.map(p => p.trend));
  const realLo = Math.min(...series.map(p => p.trend));
  svg.appendChild(text(PAD.l, y(realHi) - 8, fmtKg(realHi)));
  svg.appendChild(text(PAD.l, y(realLo) + 14, fmtKg(realLo)));

  /* — дати: тільки початок і кінець — */
  svg.appendChild(text(PAD.l, H - 8, fmtShort(series[0].date)));
  svg.appendChild(text(W - PAD.r, H - 8, fmtShort(series[series.length - 1].date), { 'text-anchor': 'end' }));
}

/**
 * Ділить ряд на відрізки «є зважування» / «пропуск». Лінія не рветься:
 * кожен новий відрізок починається з останньої точки попереднього.
 */
function splitGaps(series) {
  const out = [];
  for (let i = 1; i < series.length; i++) {
    const gap = series[i].weight == null;
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
