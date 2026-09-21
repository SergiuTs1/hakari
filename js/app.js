/* hakari — екрани і взаємодія */

import * as db from './db.js';
import {
  todayISO, fmtShort, fmtKg, fmtSigned, fmtPct, daysBetween,
  buildSeries, rateKgPerWeek, consistency, recentMap, daysSinceLast, marksTally, totalWeighins,
  lossPctPerWeek, isTooFast, bodyFatPct,
  CONSISTENCY_GOAL, FAST_LOSS_PCT, MEASURE_STALE_DAYS,
} from './calc.js';
import { renderChart, renderEnso } from './chart.js';
import { currentKou } from './kou.js';
import { photoTakenDate } from './exif.js';

const $ = id => document.getElementById(id);

/* Версія коду. Піднімати разом з CACHE у sw.js — показується внизу «записи»,
   щоб з телефону було видно, що саме зараз працює. */
const VERSION = 18;

/* стан у пам'яті: усе перемальовуємо з нього, щоб не смикати базу */
const state = {
  entries: [],
  weekly: [],
  photos: [],
  profile: null,
  range: 30,
  compareMode: false,
  comparePick: [],
};

/* ═════════════════════════  запуск  ═════════════════════════ */

init();

async function init() {
  db.requestPersistence();                 // навмисно без await — не блокує перший екран
  registerSW();

  if (isBrowserTab()) { await showBrowserNotice(); return; }

  state.profile = await db.getProfile();
  state.entries = await db.daily.all();
  state.weekly = await db.weekly.all();
  state.photos = await db.photos.all();

  bindNav();
  bindEntry();
  bindTrend();
  bindLog();
  bindPhotos();

  $('version').textContent = `версія ${VERSION}`;
  $('today-date').textContent = fmtShort(todayISO());
  $('kou-name').textContent = currentKou().name;

  renderAll();
}

/* ── вкладка браузера замість іконки ──────────────────────────
 *
 * На iOS у застосунка з домашнього екрана своє сховище, окреме від
 * Safari. Той самий сайт у вкладці — це інша база: порожня історія,
 * і введена там вага лягає в паралельну копію, якої більше ніколи
 * не побачиш. Помилка тиха, тому ввід у вкладці просто закритий.
 *
 * Потрібно це через нагадування: Команди вміють «Відкрити URL», але
 * не вміють відкрити застосунок з домашнього екрана (у списку його
 * немає). Отже вкладка вранці таки відкриється — хай вона буде
 * сигналом «тапни іконку», а не місцем, де можна зіпсувати дані.
 *
 * localhost виняток: інакше розробка перетворилась би на роботу
 * наосліп — так само, як service worker там навмисно не кешує.
 */

function isBrowserTab() {
  // список тримаємо всередині: init() викликається вище за це місце,
  // і const на рівні модуля був би ще в тимчасовій мертвій зоні
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return false;
  const standalone = navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  return !standalone;
}

async function showBrowserNotice() {
  $('browser').hidden = false;

  /* якщо в цю вкладку колись уже щось ввели — дати це забрати,
     а не сховати мовчки разом з екраном */
  const stray = await db.daily.all();
  if (!stray.length) return;

  $('browser-rescue').hidden = false;
  $('browser-count').textContent =
    `у цій вкладці ${stray.length} ${plural(stray.length, 'запис', 'записи', 'записів')}`;
  $('browser-export').addEventListener('click', doExport);
}

function renderAll() {
  renderToday();
  renderTrend();
  renderLog();
}

/* ═════════════════════════  навігація  ═════════════════════════ */

/* перехід, що зараз доганяє (fall ще не доіграв) — щоб швидкий
   повторний тап не лишив по собі два одночасно "активні" екрани */
let leaving = null;

function bindNav() {
  $('nav').addEventListener('click', e => {
    const btn = e.target.closest('button[data-screen]');
    if (!btn || btn.getAttribute('aria-selected') === 'true') return;
    switchScreen(btn);
  });
}

function switchScreen(btn) {
  const next = $('s-' + btn.dataset.screen);
  for (const b of $('nav').children) b.setAttribute('aria-selected', String(b === btn));

  if (leaving) {
    leaving.el.removeEventListener('animationend', leaving.onEnd);
    leaving.el.classList.remove('is-active', 'is-leaving');
    leaving = null;
  }

  const current = document.querySelector('.screen.is-active');
  const reveal = () => {
    if (current) current.classList.remove('is-active', 'is-leaving');
    next.classList.add('is-active');
    window.scrollTo(0, 0);
  };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!current || current === next || reduced) { reveal(); return; }

  current.classList.remove('is-active');
  current.classList.add('is-leaving');
  const onEnd = e => {
    if (e.target !== current) return;
    current.removeEventListener('animationend', onEnd);
    leaving = null;
    reveal();
  };
  current.addEventListener('animationend', onEnd);
  leaving = { el: current, onEnd };
}

/* ═════════════════════════  сьогодні  ═════════════════════════ */

function todayRecord() {
  return state.entries.find(e => e.date === todayISO()) || null;
}

function renderToday() {
  const series = buildSeries(state.entries);
  const last = series.length ? series[series.length - 1] : null;

  /* велика цифра — це ТРЕНД, а не сьогоднішня вага.
     Сира вага стрибає на ±1 кг від солі й сну; показувати її як
     головний результат — найшвидший спосіб втратити мотивацію. */
  $('trend-value').innerHTML = last
    ? `${fmtKg(last.trend)}<span class="figure__unit">кг</span>`
    : `—<span class="figure__unit">кг</span>`;

  /* енсо = консистентність за 30 днів */
  const c = consistency(state.entries);
  renderEnso($('enso-arc'), c.ratio / CONSISTENCY_GOAL);

  /* дельта за тиждень */
  const rate = rateKgPerWeek(series);
  const deltaEl = $('delta');
  if (rate == null) {
    deltaEl.textContent = state.entries.length ? 'тренд збирається' : 'перше зважування — і почнеться';
  } else {
    const warn = last && isTooFast(rate, last.trend);
    const cls = warn ? 'is-warn' : Math.abs(rate) < 0.05 ? 'is-flat' : '';
    deltaEl.innerHTML = `<b class="${cls}">${fmtSigned(rate)}</b> кг за тиждень`;
  }

  /* ── відсоток жиру ──
     Одна цифра, без кілограмів жирової й сухої маси: питання «скільки
     в мене жиру» має одну відповідь, і вона тут.
     Кольору навмисно не даємо — --shu читався б як тривога, а це
     просто показник, не попередження. Немає даних — немає й рядка:
     порожній стан на головному екрані працює як щоденний докір. */
  const fatEl = $('fat');
  const m = latestMeasured();
  if (!m) {
    fatEl.hidden = true;
  } else {
    fatEl.hidden = false;
    $('fat-value').textContent = fmtPct(m.pct);
    const stale = daysBetween(m.date, todayISO()) >= MEASURE_STALE_DAYS;
    fatEl.className = stale ? 'fat is-stale' : 'fat';
  }

  /* «з поверненням» — тихе повернення без докорів */
  const gap = daysSinceLast(state.entries);
  const ok = $('okaeri');
  if (gap != null && gap >= 7) {
    ok.hidden = false;
    $('okaeri-text').innerHTML =
      `минуло ${gap} ${plural(gap, 'день', 'дні', 'днів')}.<br>нічого не загубилось — просто зважся.`;
    $('enso-wrap').hidden = true;
  } else {
    ok.hidden = true;
    $('enso-wrap').hidden = false;
  }

  /* сьогоднішній запис, якщо вже є */
  const rec = todayRecord();
  $('t-protein').setAttribute('aria-pressed', String(!!(rec && rec.protein)));
  $('t-trained').setAttribute('aria-pressed', String(!!(rec && rec.trained)));
  renderEntry();
  renderTally();
}

/* ── поле ваги ──
   Сире число на головний екран не виходить. Раніше поле тримало
   введену вагу цілий день — за 60px під трендом, тобто рівно та цифра,
   яка стрибає на ±1 кг від солі й сну й тригерить емоцію. Тепер після
   збереження поле порожнє, а поруч стоїть «записано»: видно, що день
   зарахований, і не видно самого числа. Воно за один тап по полю —
   перевірити описку можна, натрапляти на нього щоранку ні. */
function renderEntry() {
  const rec = todayRecord();
  const saved = rec && rec.weight ? rec.weight : null;
  const input = $('weight');

  // поле під пальцем не чіпаємо: renderToday() смикається й з інших екранів
  if (document.activeElement !== input) input.value = '';
  input.placeholder = saved ? '' : '00.0';
  $('entry-unit').hidden = !!saved;      // «кг» без числа — самотній підпис
  $('entry-done').hidden = !saved;
  validateEntry();
}

/* ── підсумок перемикачів за тиждень ──
   Досі перемикачі писались у базу й нічого не повертали; це віддача за
   них — рівно те, що натиснуто, без цілі й без знаменника. Порожнє
   ховаємо цілком, а нуль в одному з двох — разом із його підписом:
   «тренування 0» на головному екрані читається як докір, а не як число. */
function renderTally() {
  const t = marksTally(state.entries);
  const row = $('tally');
  row.hidden = !t.protein && !t.trained;
  if (row.hidden) return;

  for (const [id, n] of [['tally-protein', t.protein], ['tally-trained', t.trained]]) {
    $(id).hidden = !n;
    $(id).querySelector('b').textContent = n;
  }
}

function bindEntry() {
  const input = $('weight');

  input.addEventListener('input', validateEntry);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveWeight(); }
  });

  /* тап по полю дістає збережене число — на випадок описки. Вихід
     без правки ховає його знову; набране, але не збережене лишаємо
     на місці, інакше правка зникала б просто під пальцем. */
  input.addEventListener('focus', () => {
    const rec = todayRecord();
    if (!input.value && rec && rec.weight) input.value = String(rec.weight);
  });
  input.addEventListener('blur', () => {
    const rec = todayRecord();
    const typed = parseWeight(input.value);
    if (typed === null || (rec && typed === rec.weight)) renderEntry();
  });
  $('save').addEventListener('click', saveWeight);

  for (const [id, key] of [['t-protein', 'protein'], ['t-trained', 'trained']]) {
    $(id).addEventListener('click', async () => {
      const btn = $(id);
      const next = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(next));
      await upsertToday({ [key]: next });
      /* перемальовуємо тільки підсумок: renderToday() тут перезаписав би
         поле ваги просто під пальцем, поки цифру ще набирають */
      renderTally();
    });
  }
}

/** Кома як десятковий роздільник — на українській розкладці це звична крапка. */
function parseWeight(raw) {
  const v = parseFloat(String(raw).replace(',', '.').trim());
  return Number.isFinite(v) && v >= 30 && v <= 300 ? v : null;
}

function validateEntry() {
  const input = $('weight');
  $('save').disabled = parseWeight(input.value) === null;

  /* У стані спокою після зважування кнопці нема чого робити, а «ЗАПИСАНО»
     і «ЗАПИСАТИ» поруч — два однакові слова в один рядок. Кнопка
     повертається, щойно в полі знову щось набрано. */
  const rec = todayRecord();
  $('save').hidden = !!(rec && rec.weight) && input.value === '';
}

async function saveWeight() {
  const w = parseWeight($('weight').value);
  if (w === null) return;
  await upsertToday({ weight: w });
  $('weight').blur();
  toast('записано');
  renderAll();
}

async function upsertToday(patch) {
  const iso = todayISO();
  const prev = todayRecord() || { date: iso, weight: null, protein: false, trained: false };
  const rec = { ...prev, ...patch, date: iso };
  await db.daily.put(rec);
  state.entries = await db.daily.all();
  if (!state.profile.startDate) {
    // найраніший наявний запис, а не сьогодні: інакше після відновлення
    // з бекапу початок відліку зсунувся б на день імпорту
    const start = state.entries.length ? state.entries[0].date : iso;
    state.profile = { ...state.profile, startDate: start };
    await db.setProfile({ startDate: start });
  }
}

/* ═════════════════════════  склад тіла  ═════════════════════════ */

/**
 * Останній обмір, з якого формула дала число.
 * Шукаємо з кінця, а не беремо просто найновіший запис: неповний
 * сьогоднішній обмір не має гасити цифру. Шия тижнями стоїть на
 * місці, і забути її — не причина втратити показник.
 */
function latestMeasured() {
  const { sex, height } = state.profile;
  for (let i = state.weekly.length - 1; i >= 0; i--) {
    const rec = state.weekly[i];
    const pct = bodyFatPct({ sex, height, neck: rec.neck, waist: rec.waist, hips: rec.hips });
    if (pct != null) return { date: rec.date, pct };
  }
  return null;
}

/* Записи йдуть чергою, і попередній стан читається з бази, а не з
   пам'яті. Інакше два швидкі збереження підряд (ввів шию, одразу
   талію) читають однаково порожній запис і друге перетирає перше —
   обмір зникає мовчки. */
let weeklyQueue = Promise.resolve();

function upsertWeekly(patch) {
  weeklyQueue = weeklyQueue.then(async () => {
    const iso = todayISO();
    const prev = (await db.weekly.get(iso)) || { date: iso };
    await db.weekly.put({ ...prev, ...patch, date: iso });
    state.weekly = await db.weekly.all();
  });
  return weeklyQueue;
}

/* ═════════════════════════  тренд  ═════════════════════════ */

function bindTrend() {
  $('ranges').addEventListener('click', e => {
    const btn = e.target.closest('button[data-range]');
    if (!btn) return;
    for (const b of $('ranges').children) b.setAttribute('aria-selected', String(b === btn));
    state.range = Number(btn.dataset.range);
    renderTrend();
  });
}

function renderTrend() {
  const full = buildSeries(state.entries);
  const series = state.range > 0 ? full.slice(-state.range) : full;

  renderChart($('chart'), series);

  if (!full.length) {
    for (const id of ['k-start', 'k-now', 'k-total', 'k-rate']) $(id).textContent = '—';
    $('rate-note').hidden = true;
    return;
  }

  const first = full[0];
  const last = full[full.length - 1];
  const total = last.trend - first.trend;
  const rate = rateKgPerWeek(full);

  $('k-start').textContent = `${fmtKg(first.trend)} кг · ${fmtShort(first.date)}`;
  $('k-now').textContent = `${fmtKg(last.trend)} кг`;

  $('k-total').textContent = `${fmtSigned(total, 1)} кг`;
  $('k-total').className = 'kv__v' + (total < -0.2 ? '' : ' is-dim');

  $('k-rate').textContent = rate == null ? '—' : `${fmtSigned(rate)} кг / тиж`;
  $('k-rate').className = 'kv__v' + (isTooFast(rate, last.trend) ? ' is-warn' : '');

  /* нагляд за темпом: понад ~1% маси на тиждень — зона втрати м'язів */
  const note = $('rate-note');
  if (isTooFast(rate, last.trend)) {
    const pct = lossPctPerWeek(rate, last.trend);
    note.hidden = false;
    note.innerHTML =
      `Темп ${pct.toFixed(1)}% маси на тиждень — вище за орієнтир ${FAST_LOSS_PCT}%.<br>` +
      `На такій швидкості зазвичай починає йти й м’яз. Варто додати їжі або збільшити білок.`;
  } else {
    note.hidden = true;
  }
}

/* ═════════════════════════  записи  ═════════════════════════ */

function bindLog() {
  $('log').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-del]');
    if (!btn) return;
    await db.daily.del(btn.dataset.del);
    state.entries = await db.daily.all();
    renderAll();
    toast('видалено');
  });

  bindProfileField('p-height', 'height', v => (v >= 100 && v <= 250 ? v : null));

  $('p-sex').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-sex]');
    if (!btn) return;
    const sex = btn.dataset.sex;
    state.profile = { ...state.profile, sex };
    await db.setProfile({ sex });
    renderToday();
    renderLog();
  });

  /* Обміри зберігаються так само, як профіль: по change, без кнопки.
     Тижневий ввід і так рідкий — не додаємо до нього ще один тап. */
  bindMeasure('m-neck', 'neck', 20, 70);
  bindMeasure('m-waist', 'waist', 40, 200);
  bindMeasure('m-hips', 'hips', 50, 200);

  $('export').addEventListener('click', doExport);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', doImport);
}

function bindProfileField(id, key, validate) {
  const inp = $(id);
  inp.addEventListener('change', async () => {
    const raw = inp.value.replace(',', '.').trim();
    const v = validate(parseFloat(raw));
    if (v === null || Number.isNaN(v)) { renderLog(); return; }   // тихо відкочуємо
    state.profile = { ...state.profile, [key]: v };
    await db.setProfile({ [key]: v });
    renderToday();                       // зріст живить формулу Navy, тобто % жиру
    toast('збережено');
  });
}

function bindMeasure(id, key, lo, hi) {
  const inp = $(id);
  inp.addEventListener('change', async () => {
    const raw = inp.value.replace(',', '.').trim();
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v < lo || v > hi) { renderLog(); return; }   // тихо відкочуємо
    await upsertWeekly({ [key]: v });
    renderToday();
    renderLog();
    toast('збережено');
  });
}

function renderLog() {
  /* календар-кінцугі: пропуск — не провал, а золота тріщина */
  const start = state.entries.length ? state.entries[0].date : null;
  const grid = $('grid');
  grid.textContent = '';
  for (const d of recentMap(state.entries)) {
    const i = document.createElement('i');
    // Дні до першого запису — не пропуски: тоді ще нічого не почалось.
    // Без цього чисте встановлення зустрічає людину тридцятьма золотими
    // рисками, тобто докором за невідстежені дні, яких не існувало.
    const before = !start || d.date < start;
    if (d.on) i.className = 'is-on';
    else if (!before) i.className = 'is-gap';
    i.title = fmtShort(d.date);
    grid.appendChild(i);
  }

  /* Сама кількість записаних днів, без «10%» і без «з 30»: знаменник
     перетворював рядок на табель успішності, а відсоток — на оцінку.
     Ціль 80% лишається живою в енсо на «сьогодні», де чисел немає.
     Нуль ховаємо цілком — «0 днів» на чистому старті це докір. */
  const c = consistency(state.entries);
  $('consist-row').hidden = !c.filled;
  if (c.filled) {
    $('k-consist').textContent = `${c.filled} ${plural(c.filled, 'день', 'дні', 'днів')}`;
    $('k-consist').className = 'kv__v';
  }

  /* ── зважувань за весь час ──
     Число, яке пропуск не зменшує: провалити його неможливо, тому
     й уникати застосунку після зриву немає причини. Працює не в
     моменті, а на довгій дистанції — тому стоїть у «записи», куди
     заходять на тижневий ритуал, а не на «сьогодні» поруч із трендом.
     Нуль ховаємо: «0 зважувань» на чистому старті — це докір. */
  const total = totalWeighins(state.entries);
  $('weighins-row').hidden = !total.count;
  if (total.count) {
    $('k-weighins').innerHTML =
      `${total.count}<i class="kv__since">з ${fmtShort(total.since)}</i>`;
  }

  /* записи, найновіші зверху */
  const list = $('log');
  list.textContent = '';
  const recent = state.entries.slice().reverse();
  $('log-empty').hidden = recent.length > 0;

  for (const e of recent.slice(0, 60)) {
    const li = document.createElement('li');
    li.className = 'log__item';
    // одна літера на кожен перемикач: рядок журналу вузький, а слова
    // цілком тут відсунули б саму вагу
    const marks = (e.protein ? 'Б' : '') + (e.trained ? 'Т' : '');
    li.innerHTML =
      `<span class="log__date">${fmtShort(e.date)}</span>` +
      `<span class="log__w">${e.weight ? fmtKg(e.weight) + ' кг' : '—'}</span>` +
      `<span class="log__marks">${marks}</span>` +
      `<button class="log__del" data-del="${e.date}" aria-label="Видалити запис">×</button>`;
    list.appendChild(li);
  }

  $('p-height').value = state.profile.height ?? '';

  for (const b of $('p-sex').children) {
    b.setAttribute('aria-checked', String(b.dataset.sex === state.profile.sex));
  }
  $('f-hips').hidden = state.profile.sex !== 'f';   // жіноча формула потребує стегон

  /* Поля показують лише сьогоднішній обмір. Підставляти минулотижневі
     значення не можна: тоді забута шия тихо записалась би як щойно
     зміряна. Коли обмір був — видно нижче. */
  const today = state.weekly.find(r => r.date === todayISO()) || {};
  $('m-neck').value  = today.neck  ?? '';
  $('m-waist').value = today.waist ?? '';
  $('m-hips').value  = today.hips  ?? '';

  const m = latestMeasured();
  $('k-measured').textContent = m ? fmtShort(m.date) : '—';
  $('k-measured').className = 'kv__v' + (m ? '' : ' is-dim');

  /* Поки зросту або статі немає — просимо їх, а не рахуємо з null.
     Запит живе тут, а не на «сьогодні»: головний екран не місце для вимог. */
  const need = $('measure-need');
  const lacks = [
    state.profile.height ? null : 'зріст',
    state.profile.sex ? null : 'стать',
  ].filter(Boolean);
  need.hidden = lacks.length === 0;
  need.textContent = lacks.length
    ? `Щоб порахувати відсоток жиру, заповни ${lacks.join(' і ')} вище.`
    : '';

  renderPhotos();
  renderBackupAge();
}

/* ═════════════════════════  фото прогресу  ═════════════════════════
 *
 * Дата тут — не ключ, а просто поле: на відміну від ваги чи обмірів,
 * фото не одне на день. Ключ — окремий id (автоінкремент у db.js),
 * інакше друге фото того самого дня мовчки перетирало б перше.
 *
 * Перед збереженням стискаємо до розумного розміру — інакше через
 * рік бекап важить десятки мегабайтів заради пікселів, яких телефон
 * і не показує. Blob лежить в IndexedDB напряму, без base64 —
 * той рядок з'являється тільки на експорті, у db.js.
 */

const PHOTO_MAX_DIM = 1280;
const PHOTO_QUALITY = 0.82;

/* URL-и для <img src>, по одному на id; ревокуються, коли фото
   зникає з вибірки — інакше кожен перерендер зʼїдає ще памʼяті. */
const photoURLs = new Map();
let viewedPhotoId = null;

function bindPhotos() {
  $('photo-add').addEventListener('click', () => $('photo-file').click());
  $('photo-file').addEventListener('change', onPhotoFile);
  $('photo-compare-toggle').addEventListener('click', togglePhotoCompare);

  $('photo-grid').addEventListener('click', e => {
    const tile = e.target.closest('.photo-tile');
    if (!tile) return;
    const id = Number(tile.dataset.id);
    if (state.compareMode) pickForCompare(id);
    else openPhoto(id);
  });

  $('photo-view-close').addEventListener('click', () => $('photo-view').close());
  $('photo-view-del').addEventListener('click', deleteViewedPhoto);
  $('photo-view').addEventListener('close', () => { viewedPhotoId = null; });

  $('photo-compare-close').addEventListener('click', () => $('photo-compare').close());
  $('photo-compare').addEventListener('close', () => {
    state.comparePick = [];
    markPickedTiles();
  });
  $('compare-slider').addEventListener('input', e => {
    $('compare-b-img').style.opacity = Number(e.target.value) / 100;
  });

  /* тап поза фото — теж закриття; для <dialog> це саме клік по самому
     елементу, а не по вмісту всередині */
  for (const dlg of [$('photo-view'), $('photo-compare')]) {
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  }
}

async function onPhotoFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    /* дата зі знімка (EXIF), якщо є — інакше сьогодні, як і раніше */
    const taken = await photoTakenDate(file);
    const blob = await resizeImage(file, PHOTO_MAX_DIM, PHOTO_QUALITY);
    await db.photos.add({ date: taken || todayISO(), blob });
    state.photos = await db.photos.all();
    renderPhotos();
    if (taken) toast('фото збережено');
    else toast(await debugNoExifToast(file), 6000);
  } catch (err) {
    toast('не вдалося обробити фото');
    console.error(err);
  }
}

/* ТИМЧАСОВО: поки з'ясовуємо, чому EXIF-дата іноді не знаходиться на
   реальних фото з iPhone. Показує тип файлу й перші байти сигнатури —
   прибрати цей тост одразу, як тільки причина стане зрозумілою. */
async function debugNoExifToast(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const hex = [...head].map(b => b.toString(16).padStart(2, '0')).join(' ');
    return `фото збережено — EXIF не знайдено (${file.type || '?'}, ${hex})`;
  } catch {
    return 'фото збережено — EXIF не знайдено';
  }
}

/** Зменшує зображення до maxDim по довшій стороні й пакує в JPEG. */
function resizeImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('фото не читається')); };
    img.src = url;
  });
}

function renderPhotos() {
  const grid = $('photo-grid');
  grid.textContent = '';
  $('photo-empty').hidden = state.photos.length > 0;

  const recent = state.photos.slice().reverse();   // найновіше зверху
  const seen = new Set();

  for (const p of recent) {
    seen.add(p.id);
    let url = photoURLs.get(p.id);
    if (!url) {
      url = URL.createObjectURL(p.blob);
      photoURLs.set(p.id, url);
    }

    const tile = document.createElement('button');
    tile.className = 'photo-tile';
    tile.dataset.id = p.id;
    tile.setAttribute('aria-label', fmtShort(p.date));
    if (state.comparePick.includes(p.id)) tile.classList.add('is-picked');

    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    tile.appendChild(img);
    grid.appendChild(tile);
  }

  /* фото, яких більше немає у вибірці (видалені), звільняють URL */
  for (const [id, url] of photoURLs) {
    if (!seen.has(id)) { URL.revokeObjectURL(url); photoURLs.delete(id); }
  }
}

function findPhoto(id) {
  return state.photos.find(p => p.id === id) || null;
}

function openPhoto(id) {
  viewedPhotoId = id;
  const p = findPhoto(id);
  $('photo-view-img').src = photoURLs.get(id);
  $('photo-view-date').textContent = p ? fmtShort(p.date) : '';
  $('photo-view').showModal();
}

async function deleteViewedPhoto() {
  if (viewedPhotoId == null) return;
  await db.photos.del(viewedPhotoId);
  state.photos = await db.photos.all();
  $('photo-view').close();
  renderPhotos();
  toast('фото видалено');
}

function togglePhotoCompare() {
  state.compareMode = !state.compareMode;
  state.comparePick = [];
  $('photo-compare-toggle').setAttribute('aria-pressed', String(state.compareMode));
  $('photo-grid').classList.toggle('is-compare', state.compareMode);
  markPickedTiles();
}

function pickForCompare(id) {
  const i = state.comparePick.indexOf(id);
  if (i >= 0) state.comparePick.splice(i, 1);
  else {
    state.comparePick.push(id);
    if (state.comparePick.length > 2) state.comparePick.shift();
  }
  markPickedTiles();
  if (state.comparePick.length === 2) showCompare();
}

function markPickedTiles() {
  for (const tile of $('photo-grid').children) {
    tile.classList.toggle('is-picked', state.comparePick.includes(Number(tile.dataset.id)));
  }
}

function showCompare() {
  const [a, b] = state.comparePick.map(findPhoto).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  $('compare-a-img').src = photoURLs.get(a.id);
  $('compare-b-img').src = photoURLs.get(b.id);
  $('compare-a-date').textContent = fmtShort(a.date);
  $('compare-b-date').textContent = fmtShort(b.date);

  $('compare-slider').value = 0;
  $('compare-b-img').style.opacity = 0;

  const days = daysBetween(a.date, b.date);
  $('compare-gap').textContent = days > 0 ? `${days} ${plural(days, 'день', 'дні', 'днів')} між фото` : '';

  $('photo-compare').showModal();
}

/* ═════════════════════════  бекап  ═════════════════════════ */

async function renderBackupAge() {
  const iso = await db.meta.get('lastBackup', null);
  const el = $('backup-age');
  if (!iso) {
    el.textContent = 'ніколи не зберігалась';
    el.className = 'is-kin';
    return;
  }
  const days = daysBetween(iso, todayISO());
  el.textContent = days === 0 ? 'сьогодні'
    : `${days} ${plural(days, 'день', 'дні', 'днів')} тому`;
  el.className = days >= 14 ? 'is-kin' : '';
}

async function doExport() {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hakari-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  await db.meta.set('lastBackup', todayISO());
  renderBackupAge();
  toast('копію збережено');
}

async function doImport(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const res = await db.importAll(JSON.parse(await file.text()));
    state.profile = await db.getProfile();
    state.entries = await db.daily.all();
    state.weekly = await db.weekly.all();
    state.photos = await db.photos.all();
    renderAll();
    toast(`відновлено ${res.daily}${res.photos ? ` + ${res.photos} фото` : ''}`);
  } catch (err) {
    toast('файл не підійшов');
    console.error(err);
  }
}

/* ═════════════════════════  дрібниці  ═════════════════════════ */

let toastTimer;
function toast(msg, ms = 1900) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), ms);
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/* iOS у режимі "з домашнього екрана" ненадійно сам перевіряє, чи зʼявився
   новий sw.js — навіть повне перезавантаження застосунку не завжди це
   запускає. Тому явно просимо перевірку при кожному відкритті й
   поверненні з фону, а щойно нова версія візьме контроль — перезавантажуємо
   сторінку самі, без ручного видалення іконки. */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;     // з file:// SW не реєструється

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      reg.update();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
    } catch (err) {
      console.warn('SW:', err);
    }
  });

  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}
