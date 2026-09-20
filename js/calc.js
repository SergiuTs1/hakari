/* hakari — математика
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
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
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

/* ── склад тіла: US Navy ──────────────────────────────────────
 *
 * Абсолютна похибка методу — близько ±3–4% жиру: щоб знати точну
 * цифру, потрібен DEXA. Але похибка стабільна й зсуває результат
 * завжди в один бік, тому це власна лінійка: порівнювати себе з
 * собою минулого місяця вона дозволяє, з чужими числами — ні.
 *
 * Найчутливіше місце — не талія сама по собі, а різниця
 * (талія − шия): один сантиметр помилки в будь-якій з двох дає
 * ~0.7% жиру. Тому шию треба мірити так само дисципліновано,
 * як талію, і завжди в тій самій позі.
 *
 *   ч:  495 / (1.0324  − 0.19077·log₁₀(талія − шия)          + 0.15456·log₁₀(зріст)) − 450
 *   ж:  495 / (1.29579 − 0.35004·log₁₀(талія + стегна − шия) + 0.22100·log₁₀(зріст)) − 450
 */

const NAVY = {
  m: { c0: 1.0324,  c1: 0.19077, c2: 0.15456 },
  f: { c0: 1.29579, c1: 0.35004, c2: 0.22100 },
};

/**
 * Відсоток жиру за US Navy. Усі обміри в сантиметрах.
 * Повертає null, якщо даних ще не вистачає — рахувати з null
 * не можна, краще нічого не показати.
 */
export function bodyFatPct({ sex, height, neck, waist, hips }) {
  const k = NAVY[sex];
  if (!k || !height || !neck || !waist) return null;
  if (sex === 'f' && !hips) return null;

  const girth = sex === 'f' ? waist + hips - neck : waist - neck;
  if (girth <= 0) return null;                    // шия більша за талію — описка у вводі

  const denom = k.c0 - k.c1 * Math.log10(girth) + k.c2 * Math.log10(height);
  if (denom <= 0) return null;

  const pct = 495 / denom - 450;
  return pct > 2 && pct < 70 ? pct : null;        // за межами — теж описка
}

/* Після скількох днів цифра вважається підстарілою й гасне.
   Десять, а не сім: пропущена неділя — не причина щось міняти. */
export const MEASURE_STALE_DAYS = 10;

/* ── консистентність (замість стріків) ────────────────────────
 *
 * Свідомо НЕ рахуємо серію поспіль. Стрік, який обнуляється, —
 * машина для провини. Рахуємо частку заповнених днів за вікно,
 * а ціль ставимо 80%, а не 100% (вабі-сабі — неповне теж добре).
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

/* ── тижневий підсумок перемикачів ────────────────────────────
 *
 * Перемикачі досі тільки писались у базу й виринали хіба що підписами в
 * журналі. Дія, за яку нічого не повертається, з часом перестає
 * здаватись вартою тапу, — тому рахуємо, скільки разів натиснуто.
 *
 * Знаменника тут навмисно немає: «5 з 7» читається як недобір, а
 * недобирати нічого — норми на тиждень не існує.
 */

export function marksTally(entries, days = 7, endISO = todayISO()) {
  const start = addDays(endISO, -(days - 1));
  let protein = 0, trained = 0;
  for (const e of entries) {
    if (e.date < start || e.date > endISO) continue;
    if (e.protein) protein++;
    if (e.trained) trained++;
  }
  return { protein, trained, days };
}

/* ── скільки зважувань за весь час ────────────────────────────
 *
 * Не серія поспіль, а сума від першого запису: число, якого пропуск
 * не зменшує. Стрік у день пропуску забирає накопичене — і саме в
 * той день застосунок закривають назавжди. Це не вміє забирати
 * нічого, тому його нема як провалити й нема чого уникати.
 *
 * Рахуємо дні саме зі зважуванням, а не будь-який рядок у базі:
 * тап по «білок» теж створює запис, і лічильник, що росте від самого
 * перемикача, швидко перестав би щось означати.
 */

export function totalWeighins(entries) {
  const days = entries.filter(e => typeof e.weight === 'number' && e.weight > 0);
  return { count: days.length, since: days.length ? days[0].date : null };
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

export function fmtPct(v, digits = 1) {
  return v == null || Number.isNaN(v) ? '—' : `${v.toFixed(digits)}%`;
}

export function fmtSigned(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return '—';
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s.replace('-', '−');   // U+2212, а не дефіс
}
