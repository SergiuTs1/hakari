/* hakari — дата зйомки з EXIF
 *
 * Фото прогресу датуються за «записи» датою на момент завантаження — але
 * знято їх часто раніше: сфотографував уранці, завантажив увечері, або
 * взагалі через кілька днів. EXIF-тег DateTimeOriginal каже, коли камера
 * справді натиснула затвор. Використовуємо його, коли є; коли нема
 * (скріншот, фото переслане месенджером — EXIF там зазвичай стертий) —
 * викликач сам падає назад на сьогодні.
 *
 * Парситься вручну: жодних бібліотек, лише бінарний розбір JPEG/TIFF.
 */

/**
 * @param {File|Blob} file
 * @returns {Promise<string|null>} 'YYYY-MM-DD' або null
 */
export async function photoTakenDate(file) {
  try {
    const buf = await file.arrayBuffer();
    return readJpegDate(new DataView(buf));
  } catch {
    return null;   // будь-яка binary-аномалія — просто немає дати, не помилка
  }
}

function readJpegDate(view) {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null;   // не JPEG

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;   // SOS — далі йдуть стиснені дані

    const size = view.getUint16(offset + 2);
    if (marker === 0xFFE1 && isExifSegment(view, offset + 4)) {
      const date = readExifDate(view, offset + 4 + 6);
      if (date) return date;
    }
    offset += 2 + size;
  }
  return null;
}

function isExifSegment(view, pos) {
  return pos + 6 <= view.byteLength &&
    view.getUint32(pos) === 0x45786966 && view.getUint16(pos + 4) === 0x0000;   // "Exif\0\0"
}

function readExifDate(view, tiffStart) {
  const bom = view.getUint16(tiffStart);
  if (bom !== 0x4949 && bom !== 0x4D4D) return null;
  const little = bom === 0x4949;
  if (view.getUint16(tiffStart + 2, little) !== 0x002A) return null;

  const ifd0 = readIfd(view, tiffStart, tiffStart + view.getUint32(tiffStart + 4, little), little);

  const exifPtr = ifd0.find(e => e.tag === 0x8769);
  if (exifPtr) {
    const exifIfd = readIfd(view, tiffStart, tiffStart + view.getUint32(exifPtr.valuePos, little), little);
    const original = exifIfd.find(e => e.tag === 0x9003) || exifIfd.find(e => e.tag === 0x9004);
    const parsed = original && parseDateString(readAscii(view, original, tiffStart, little));
    if (parsed) return parsed;
  }

  const modified = ifd0.find(e => e.tag === 0x0132);   // остання дата зміни файлу — гірший, але кращий за "сьогодні" орієнтир
  return modified ? parseDateString(readAscii(view, modified, tiffStart, little)) : null;
}

function readIfd(view, tiffStart, ifdAbs, little) {
  const count = view.getUint16(ifdAbs, little);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const pos = ifdAbs + 2 + i * 12;
    entries.push({
      tag: view.getUint16(pos, little),
      count: view.getUint32(pos + 4, little),
      valuePos: pos + 8,
    });
  }
  return entries;
}

function readAscii(view, entry, tiffStart, little) {
  const len = entry.count;
  const pos = len <= 4 ? entry.valuePos : tiffStart + view.getUint32(entry.valuePos, little);
  let s = '';
  for (let i = 0; i < len - 1; i++) s += String.fromCharCode(view.getUint8(pos + i));
  return s;
}

/** EXIF-формат: 'YYYY:MM:DD HH:MM:SS' — беремо лише дату, локально, без часового поясу. */
function parseDateString(s) {
  const m = s && /^(\d{4}):(\d{2}):(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
