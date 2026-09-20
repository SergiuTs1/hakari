/* 秤 hakari — сховище (IndexedDB)
 *
 * Сховища:
 *   daily  { date:'YYYY-MM-DD', weight, protein, trained, note }
 *   weekly { date:'YYYY-MM-DD', neck, waist, hips, ... }   ← наповниться у фазі 3
 *   photos { id (авто), date:'YYYY-MM-DD', blob }          ← фаза 5, фото прогресу
 *   meta   { k, v }                                        ← профіль, налаштування, бекап
 *
 * Сховище weekly створюємо вже зараз, щоб фаза 3 не тягнула міграцію схеми.
 *
 * photos свідомо не ключується датою: на відміну від ваги й обмірів,
 * фото не одне на день, тому ключ — id, а дата лишається звичайним
 * полем.
 */

const DB_NAME = 'hakari';
const DB_VER = 3;

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('daily'))  db.createObjectStore('daily',  { keyPath: 'date' });
      if (!db.objectStoreNames.contains('weekly')) db.createObjectStore('weekly', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('meta'))   db.createObjectStore('meta',   { keyPath: 'k' });

      /* v2 завела photos з ключем 'date' (одне фото на день) — виявилось,
         що це неправильна модель: друге фото того самого дня мовчки
         перетирало перше. v3 переносить наявні фото на автоінкремент id,
         не втрачаючи те, що вже збережено. */
      if (event.oldVersion < 3) {
        const hadOld = db.objectStoreNames.contains('photos');
        const old = hadOld ? req.transaction.objectStore('photos') : null;
        const carry = [];
        const rebuild = () => {
          if (hadOld) db.deleteObjectStore('photos');
          const next = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
          for (const rec of carry) next.add({ date: rec.date, blob: rec.blob });
        };
        if (old) {
          old.openCursor().onsuccess = e => {
            const cursor = e.target.result;
            if (cursor) { carry.push(cursor.value); cursor.continue(); }
            else rebuild();
          };
        } else {
          rebuild();
        }
      }
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

/* ── фото прогресу ────────────────────────────────────────────
 * На відміну від обмірів, фото не одне на дату: ключ — id, а не
 * дата, тому кілька знімків того самого дня співіснують, а не
 * перекривають один одного. */

export const photos = {
  /** {date, blob} → id присвоюється автоматично. */
  add: rec => tx('photos', 'readwrite', s => s.add(rec)),
  del: id  => tx('photos', 'readwrite', s => s.delete(id)),
  all: ()  => tx('photos', 'readonly',  s => s.getAll()).then(r => r.sort(byDate)),
};

/* ── метадані ─────────────────────────────────────────────── */

export const meta = {
  get: (k, fallback = null) =>
    tx('meta', 'readonly', s => s.get(k)).then(r => (r === undefined ? fallback : r.v)),
  set: (k, v) => tx('meta', 'readwrite', s => s.put({ k, v })),
};

function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }

/* ── профіль ──────────────────────────────────────────────── */

/* Порожній навмисно: репозиторій публічний, тож жодних особистих значень
   у дефолтах. Зріст і стать користувач вводить у застосунку — вони
   знадобляться формулі US Navy у фазі 3. */
export const DEFAULT_PROFILE = {
  height: null,
  sex: null,
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

/* Фото йдуть у той самий файл, що й усе інше. Окремий експорт для фото
   означав би два бекапи замість одного — а забути про другий саме той
   ризик, якому тижневий ритуал і має запобігати. Blob кодуємо в base64:
   формат лишається plain JSON, який зливається так само, як завжди. */

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, type) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function exportAll() {
  const [d, w, p, profile] = await Promise.all([daily.all(), weekly.all(), photos.all(), getProfile()]);
  const photosOut = await Promise.all(p.map(async rec => ({
    date: rec.date,
    type: rec.blob.type || 'image/jpeg',
    data: await blobToBase64(rec.blob),
  })));
  return {
    app: 'hakari',
    version: DB_VER,
    exportedAt: new Date().toISOString(),
    profile,
    daily: d,
    weekly: w,
    photos: photosOut,
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
  const p = Array.isArray(payload.photos) ? payload.photos : [];

  for (const rec of d) if (rec && rec.date) await daily.put(rec);
  for (const rec of w) if (rec && rec.date) await weekly.put(rec);
  /* Кожне фото з бекапу додається новим записом (свій id), а не
     перекриває існуюче за датою — на одну дату їх може бути кілька.
     Наслідок: повторний імпорт того самого файлу задвоїть фото,
     на відміну від ваги й обмірів. Для разового відновлення це не
     проблема, для звички імпортувати вдруге — варто памʼятати. */
  for (const rec of p) {
    if (!rec || !rec.date || !rec.data) continue;
    await photos.add({ date: rec.date, blob: base64ToBlob(rec.data, rec.type) });
  }
  if (payload.profile) await setProfile(payload.profile);

  return { daily: d.length, weekly: w.length, photos: p.length };
}
