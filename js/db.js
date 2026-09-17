/* 秤 hakari — сховище (IndexedDB)
 *
 * Сховища:
 *   daily  { date:'YYYY-MM-DD', weight, protein, trained, note }
 *   weekly { date:'YYYY-MM-DD', neck, waist, hips, ... }   ← наповниться у фазі 3
 *   meta   { k, v }                                        ← профіль, налаштування, бекап
 *
 * Сховище weekly створюємо вже зараз, щоб фаза 3 не тягнула міграцію схеми.
 */

const DB_NAME = 'hakari';
const DB_VER = 1;

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('daily'))  db.createObjectStore('daily',  { keyPath: 'date' });
      if (!db.objectStoreNames.contains('weekly')) db.createObjectStore('weekly', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('meta'))   db.createObjectStore('meta',   { keyPath: 'k' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/* ── щоденні записи ───────────────────────────────────────── */

export const daily = {
  put:  rec  => tx('daily', 'readwrite', s => s.put(rec)),
  get:  date => tx('daily', 'readonly',  s => s.get(date)),
  del:  date => tx('daily', 'readwrite', s => s.delete(date)),
  /** усі записи, відсортовані за датою за зростанням */
  all:  ()   => tx('daily', 'readonly',  s => s.getAll()).then(r => r.sort(byDate)),
};

/* ── тижневі обміри ───────────────────────────────────────── */

export const weekly = {
  put: rec  => tx('weekly', 'readwrite', s => s.put(rec)),
  get: date => tx('weekly', 'readonly',  s => s.get(date)),
  del: date => tx('weekly', 'readwrite', s => s.delete(date)),
  all: ()   => tx('weekly', 'readonly',  s => s.getAll()).then(r => r.sort(byDate)),
};

/* ── метадані ─────────────────────────────────────────────── */

export const meta = {
  get: (k, fallback = null) =>
    tx('meta', 'readonly', s => s.get(k)).then(r => (r === undefined ? fallback : r.v)),
  set: (k, v) => tx('meta', 'readwrite', s => s.put({ k, v })),
};

function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }

/* ── профіль ──────────────────────────────────────────────── */

export const DEFAULT_PROFILE = {
  height: 175,
  sex: 'm',
  goalWeight: null,
  goalRate: 0.5,      // цільовий темп, кг/тиждень
  startDate: null,
  reminder: '07:30',
};

export function getProfile() {
  return meta.get('profile', {}).then(p => ({ ...DEFAULT_PROFILE, ...p }));
}

export function setProfile(patch) {
  return getProfile().then(p => meta.set('profile', { ...p, ...patch }));
}

/* ── постійне сховище ─────────────────────────────────────────
 * Safari може витирати локальні дані сайтів, якими давно не користувались.
 * Просимо систему закріпити сховище. Відмова не критична — бекап усе одно
 * лишається обов'язковою частиною тижневого ритуалу.
 */

export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/* ── бекап ────────────────────────────────────────────────── */

export async function exportAll() {
  const [d, w, profile] = await Promise.all([daily.all(), weekly.all(), getProfile()]);
  return {
    app: 'hakari',
    version: DB_VER,
    exportedAt: new Date().toISOString(),
    profile,
    daily: d,
    weekly: w,
  };
}

/**
 * Зливає імпортований бекап із наявними даними.
 * Записи з бекапу перекривають однойменні дати — дані ніколи не зникають мовчки.
 */
export async function importAll(payload) {
  if (!payload || payload.app !== 'hakari') throw new Error('Не файл hakari');
  const d = Array.isArray(payload.daily) ? payload.daily : [];
  const w = Array.isArray(payload.weekly) ? payload.weekly : [];

  for (const rec of d) if (rec && rec.date) await daily.put(rec);
  for (const rec of w) if (rec && rec.date) await weekly.put(rec);
  if (payload.profile) await setProfile(payload.profile);

  return { daily: d.length, weekly: w.length };
}
