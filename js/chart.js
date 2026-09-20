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

  /* — тренд: суцільний штрих — */
  svg.appendChild(el('path', {
    class: 'chart__trend',
    d: series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.trend).toFixed(1)}`).join(' '),
  }));

  /* — межі шкали: дві цифри, більше нічого — */
  const realHi = Math.max(...series.map(p => p.trend));
  const realLo = Math.min(...series.map(p => p.trend));
  svg.appendChild(text(PAD.l, y(realHi) - 8, fmtKg(realHi)));
  svg.appendChild(text(PAD.l, y(realLo) + 14, fmtKg(realLo)));

  /* — дати: тільки початок і кінець — */
  svg.appendChild(text(PAD.l, H - 8, fmtShort(series[0].date)));
  svg.appendChild(text(W - PAD.r, H - 8, fmtShort(series[series.length - 1].date), { 'text-anchor': 'end' }));
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

export function renderEnso(arc, ratio) {
  const r = Number(arc.getAttribute('r'));
  const C = 2 * Math.PI * r;
  const len = Math.max(0, Math.min(1, ratio)) * SWEEP * C;

  // нульова дуга з круглим наконечником малюється як крапка — ховаємо її
  arc.style.opacity = len < 0.5 ? '0' : '';
  arc.setAttribute('stroke-dasharray', `${len.toFixed(2)} ${C.toFixed(2)}`);
  arc.setAttribute('stroke-dashoffset', '0');
}
