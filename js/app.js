/* 秤 hakari — екрани і взаємодія */

import * as db from './db.js';
import {
  todayISO, fmtShort, fmtKg, fmtSigned, daysBetween,
  buildSeries, rateKgPerWeek, consistency, recentMap, daysSinceLast,
  lossPctPerWeek, isTooFast, CONSISTENCY_GOAL, FAST_LOSS_PCT,
} from './calc.js';
import { renderChart, renderEnso } from './chart.js';
import { currentKou } from './kou.js';

const $ = id => document.getElementById(id);

/* стан у пам'яті: усе перемальовуємо з нього, щоб не смикати базу */
const state = {
  entries: [],
  profile: null,
  range: 30,
};

/* ═════════════════════════  запуск  ═════════════════════════ */

init();

async function init() {
  db.requestPersistence();                 // навмисно без await — не блокує перший екран
  registerSW();

  state.profile = await db.getProfile();
  state.entries = await db.daily.all();

  bindNav();
  bindEntry();
  bindTrend();
  bindLog();

  $('today-date').textContent = fmtShort(todayISO());
  const kou = currentKou();
  $('kou-kanji').textContent = kou.kanji;
  $('kou-name').textContent = kou.name;

  renderAll();
}

function renderAll() {
  renderToday();
  renderTrend();
  renderLog();
}

/* ═════════════════════════  навігація  ═════════════════════════ */

function bindNav() {
  $('nav').addEventListener('click', e => {
    const btn = e.target.closest('button[data-screen]');
    if (!btn) return;
    for (const b of $('nav').children) b.setAttribute('aria-selected', String(b === btn));
    for (const s of document.querySelectorAll('.screen')) s.classList.remove('is-active');
    $('s-' + btn.dataset.screen).classList.add('is-active');
    window.scrollTo(0, 0);
  });
}

/* ═════════════════════════  今日  ═════════════════════════ */

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

  /* 「おかえり」 — тихе повернення без докорів */
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
  $('weight').value = rec && rec.weight ? String(rec.weight) : '';
  $('t-protein').setAttribute('aria-pressed', String(!!(rec && rec.protein)));
  $('t-trained').setAttribute('aria-pressed', String(!!(rec && rec.trained)));
  validateEntry();
}

function bindEntry() {
  const input = $('weight');

  input.addEventListener('input', validateEntry);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveWeight(); }
  });
  $('save').addEventListener('click', saveWeight);

  for (const [id, key] of [['t-protein', 'protein'], ['t-trained', 'trained']]) {
    $(id).addEventListener('click', async () => {
      const btn = $(id);
      const next = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(next));
      await upsertToday({ [key]: next });
    });
  }
}

/** Кома як десятковий роздільник — на українській розкладці це звична крапка. */
function parseWeight(raw) {
  const v = parseFloat(String(raw).replace(',', '.').trim());
  return Number.isFinite(v) && v >= 30 && v <= 300 ? v : null;
}

function validateEntry() {
  $('save').disabled = parseWeight($('weight').value) === null;
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

/* ═════════════════════════  推移  ═════════════════════════ */

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
  const goal = state.profile.goalWeight;

  renderChart($('chart'), series, goal);

  if (!full.length) {
    for (const id of ['k-start', 'k-now', 'k-total', 'k-rate', 'k-togo']) $(id).textContent = '—';
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

  $('k-togo').textContent = goal ? `${fmtKg(Math.abs(last.trend - goal))} кг` : '—';
  $('k-togo').className = 'kv__v' + (goal ? '' : ' is-dim');

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

/* ═════════════════════════  記録  ═════════════════════════ */

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
  bindProfileField('p-goal', 'goalWeight', v => (v >= 30 && v <= 300 ? v : null), true);

  $('export').addEventListener('click', doExport);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', doImport);
}

function bindProfileField(id, key, validate, nullable = false) {
  const inp = $(id);
  inp.addEventListener('change', async () => {
    const raw = inp.value.replace(',', '.').trim();
    if (nullable && raw === '') {
      state.profile = { ...state.profile, [key]: null };
      await db.setProfile({ [key]: null });
      renderTrend();
      return;
    }
    const v = validate(parseFloat(raw));
    if (v === null || Number.isNaN(v)) { renderLog(); return; }   // тихо відкочуємо
    state.profile = { ...state.profile, [key]: v };
    await db.setProfile({ [key]: v });
    renderTrend();
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
    const before = start && d.date < start;
    if (d.on) i.className = 'is-on';
    else if (!before) i.className = 'is-gap';
    i.title = fmtShort(d.date);
    grid.appendChild(i);
  }

  const c = consistency(state.entries);
  const pct = Math.round(c.ratio * 100);
  const el = $('k-consist');
  el.textContent = `${pct}% · ${c.filled} з ${c.days}`;
  el.className = 'kv__v' + (c.ratio >= CONSISTENCY_GOAL ? '' : ' is-kin');

  /* записи, найновіші зверху */
  const list = $('log');
  list.textContent = '';
  const recent = state.entries.slice().reverse();
  $('log-empty').hidden = recent.length > 0;

  for (const e of recent.slice(0, 60)) {
    const li = document.createElement('li');
    li.className = 'log__item';
    const marks = (e.protein ? '白' : '') + (e.trained ? '鍛' : '');
    li.innerHTML =
      `<span class="log__date">${fmtShort(e.date)}</span>` +
      `<span class="log__w">${e.weight ? fmtKg(e.weight) + ' кг' : '—'}</span>` +
      `<span class="log__marks">${marks}</span>` +
      `<button class="log__del" data-del="${e.date}" aria-label="Видалити запис">×</button>`;
    list.appendChild(li);
  }

  $('p-height').value = state.profile.height ?? '';
  $('p-goal').value = state.profile.goalWeight ?? '';
  renderBackupAge();
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
    renderAll();
    toast(`відновлено ${res.daily}`);
  } catch (err) {
    toast('файл не підійшов');
    console.error(err);
  }
}

/* ═════════════════════════  дрібниці  ═════════════════════════ */

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 1900);
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;     // з file:// SW не реєструється
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW:', err));
  });
}
