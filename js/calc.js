/* 秤 hakari — математика
 *
 * Тут живе вся аналітика. Фаза 3 (US Navy → жир / суха маса) додається сюди ж.
 * Жодних звертань до DOM чи бази — тільки чисті функції.
 */

/* ── дати (завжди локальні, ніколи UTC) ───────────────────── */

export function toISO(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayISO = () => toISO(new Date());

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function daysBetween(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000);
}

const MONTHS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];

export function fmtShort(iso) {
  const d = fromISO(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/* ── згладжений тренд ─────────────────────────────────────────
 *
 * EMA за методом Hacker's Diet. Ключова властивість — толерантність до
 * пропусків: у день без зважування тренд просто не рухається. Саме це
 * дозволяє пропустити тиждень і повернутись, нічого не зламавши.
 *
 *   trend[i] = trend[i-1] + α · (weight[i] − trend[i-1])
 */

export const ALPHA = 0.1;

/**
 * Будує щільний ряд по днях від першого запису до сьогодні.
 * @returns {Array<{date, weight: number|null, trend: number}>}
 */
export function buildSeries(entries, alpha = ALPHA) {
  const withWeight = entries.filter(e => typeof e.weight === 'number' && e.weight > 0);
  if (!withWeight.length) return [];

  const byDate = new Map(withWeight.map(e => [e.date, e.weight]));
  const first = withWeight[0].date;
  const last = maxISO(withWeight[withWeight.length - 1].date, todayISO());

  const out = [];
  let trend = withWeight[0].weight;

  for (let iso = first; daysBetween(iso, last) >= 0; iso = addDays(iso, 1)) {
    const w = byDate.has(iso) ? byDate.get(iso) : null;
    if (w !== null) trend += alpha * (w - trend);
    out.push({ date: iso, weight: w, trend });
  }
  return out;
}

const maxISO = (a, b) => (a > b ? a : b);

/* ── темп зміни ───────────────────────────────────────────────
 * Лінійна регресія по згладженому тренду за останні N днів.
 * Береться саме тренд, а не сирі ваги — інакше один солоний вечір
 * перетворює тижневий висновок на сміття.
 */

export function rateKgPerWeek(series, days = 21) {
  const tail = series.slice(-days);
  if (tail.length < 4) return null;

  const n = tail.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  tail.forEach((p, i) => {
    sx += i; sy += p.trend; sxy += i * p.trend; sxx += i * i;
  });

  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  return ((n * sxy - sx * sy) / denom) * 7;   // кг за день → кг за тиждень
}

/* ── нагляд за швидкістю ──────────────────────────────────────
 * Втрата понад ~1% маси тіла на тиждень — зона, де починають
 * відчутно горіти м'язи. Це підказка, а не діагноз.
 */

export const FAST_LOSS_PCT = 1.0;

export function lossPctPerWeek(rate, weight) {
  if (rate == null || !weight) return null;
  return (-rate / weight) * 100;
}

export function isTooFast(rate, weight) {
  const pct = lossPctPerWeek(rate, weight);
  return pct != null && pct > FAST_LOSS_PCT;
}

/* ── консистентність (замість стріків) ────────────────────────
 *
 * Свідомо НЕ рахуємо серію поспіль. Стрік, який обнуляється, —
 * машина для провини. Рахуємо частку заповнених днів за вікно,
 * а ціль ставимо 80%, а не 100% (侘寂 — неповне теж добре).
 */

export const CONSISTENCY_GOAL = 0.8;

export function consistency(entries, days = 30, endISO = todayISO()) {
  const start = addDays(endISO, -(days - 1));
  const hit = new Set(entries.filter(e => e.date >= start && e.date <= endISO).map(e => e.date));
  return { filled: hit.size, days, ratio: hit.size / days };
}

/** Мапа останніх N днів: true = є запис. Для календаря-кінцугі. */
export function recentMap(entries, days = 30, endISO = todayISO()) {
  const hit = new Set(entries.map(e => e.date));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const iso = addDays(endISO, -i);
    out.push({ date: iso, on: hit.has(iso) });
  }
  return out;
}

/** Скільки днів минуло від останнього запису. null — записів ще немає. */
export function daysSinceLast(entries) {
  if (!entries.length) return null;
  return daysBetween(entries[entries.length - 1].date, todayISO());
}

/* ── числа ────────────────────────────────────────────────── */

export function fmtKg(v, digits = 1) {
  return v == null || Number.isNaN(v) ? '—' : v.toFixed(digits);
}

export function fmtSigned(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return '—';
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s.replace('-', '−');   // U+2212, а не дефіс
}
