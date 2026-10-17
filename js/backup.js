// 백업(내보내기) / 복원. 형식: ticketbook-backup.zip
//   data.json            티켓·티켓북 정보
//   images/<id>.jpg      티켓 이미지(원본 품질)
//   images/<id>-pN.jpg   함께 찍은 사진
//   thumbs/<id>.jpg      목록용 썸네일
import * as DB from './db.js';
import { makeZip, readZip } from './zip.js';
import { makeThumb } from './image.js';

const ext = (b) => (b.type === 'image/png' ? 'png' : b.type === 'image/webp' ? 'webp' : 'jpg');

export async function createBackup(onProgress) {
  const [tickets, books] = await Promise.all([DB.getAll('tickets'), DB.getAll('books')]);
  const files = [];
  const outBooks = books.map((b) => {
    const o = { ...b };
    delete o.cover;
    if (b.cover) {
      o.coverFile = `images/book-${b.id}.${ext(b.cover)}`;
      files.push({ name: o.coverFile, blob: b.cover });
    }
    return o;
  });
  const customs = (await DB.metaGet('customTypes')) || [];
  const outCustoms = customs.map((c) => {
    const o = { ...c };
    delete o.photo;
    if (c.photo) {
      o.photoFile = `images/ct-${c.id}.${ext(c.photo)}`;
      files.push({ name: o.photoFile, blob: c.photo });
    }
    return o;
  });
  const bg = await DB.metaGet('background');
  let outBg = null;
  if (bg && (bg.color || bg.image)) {
    outBg = { color: bg.color || null, veil: bg.veil ?? 55 };
    if (bg.image) { outBg.imageFile = `images/background.${ext(bg.image)}`; files.push({ name: outBg.imageFile, blob: bg.image }); }
  }
  const outTickets = [];
  for (const t of tickets) {
    const o = { ...t };
    delete o.thumb;
    const bl = await DB.getBlobs(t.id);
    if (bl.image) {
      o.imageFile = `images/${t.id}.${ext(bl.image)}`;
      files.push({ name: o.imageFile, blob: bl.image });
    }
    if (t.thumb) {
      o.thumbFile = `thumbs/${t.id}.jpg`;
      files.push({ name: o.thumbFile, blob: t.thumb });
    }
    o.photoFiles = (bl.photos || []).map((p, k) => {
      const name = `images/${t.id}-p${k}.${ext(p)}`;
      files.push({ name, blob: p });
      return name;
    });
    outTickets.push(o);
  }
  const data = { app: 'ticketbook', version: 1, exportedAt: new Date().toISOString(), books: outBooks, customTypes: outCustoms, background: outBg, tickets: outTickets };
  const readme = 'TIMOA 백업 파일입니다. 이 zip을 TIMOA 앱의 [보관함 > 백업에서 복원]으로 불러오면 티켓과 사진이 되살아납니다.\r\nimages 폴더에는 등록한 티켓 이미지와 사진이 원본 그대로 들어 있습니다.\r\n';
  files.unshift({ name: 'data.json', blob: new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }) });
  files.push({ name: 'README.txt', blob: new Blob([readme], { type: 'text/plain' }) });
  return makeZip(files, onProgress);
}

// 파일을 열어 내용 요약만 반환 (복원 확인 화면용)
export async function inspectBackup(file) {
  const zip = await readZip(file);
  const dataBlob = await zip.blob('data.json');
  if (!dataBlob) throw new Error('TIMOA 백업 파일이 아니에요. (data.json 없음)');
  const data = JSON.parse(await dataBlob.text());
  if (data.app !== 'ticketbook' || !Array.isArray(data.tickets)) throw new Error('TIMOA 백업 파일이 아니에요.');
  const missing = [];
  for (const t of data.tickets) {
    for (const n of [t.imageFile, t.thumbFile, ...(t.photoFiles || [])]) if (n && !zip.has(n)) missing.push(n);
  }
  for (const c of data.customTypes || []) if (c.photoFile && !zip.has(c.photoFile)) missing.push(c.photoFile);
  if (data.background?.imageFile && !zip.has(data.background.imageFile)) missing.push(data.background.imageFile);
  if (missing.length) throw new Error(`백업 파일이 손상되었어요. (이미지 ${missing.length}개 누락)`);
  return { zip, data };
}

// mode: 'merge'(기존 유지, 같은 티켓은 덮어씀) | 'replace'(기존 삭제 후 복원)
export async function restoreBackup({ zip, data }, mode, onProgress) {
  if (mode === 'replace') await DB.clearAll();
  for (const b of data.books || []) {
    const rec = { ...b };
    delete rec.coverFile;
    rec.cover = b.coverFile ? await zip.blob(b.coverFile) : null;
    await DB.putBook(rec);
  }
  // 내 종류(최애): 합치기는 같은 id를 백업 기준으로 덮어쓰고, 모두 바꾸기는 백업 그대로
  const merged = new Map((mode === 'replace' ? [] : (await DB.metaGet('customTypes')) || []).map((c) => [c.id, c]));
  for (const c of data.customTypes || []) {
    const rec = { ...c };
    delete rec.photoFile;
    rec.photo = c.photoFile ? await zip.blob(c.photoFile) : null;
    merged.set(rec.id, rec);
  }
  await DB.metaSet('customTypes', [...merged.values()]);
  if (data.background) {
    const b = data.background;
    await DB.metaSet('background', { color: b.color || null, veil: b.veil ?? 55, image: b.imageFile ? await zip.blob(b.imageFile) : null });
  } else if (mode === 'replace') {
    await DB.metaSet('background', { color: null, image: null, veil: 55 });
  }
  let i = 0;
  for (const o of data.tickets) {
    const image = o.imageFile ? await zip.blob(o.imageFile) : null;
    let thumb = o.thumbFile ? await zip.blob(o.thumbFile) : null;
    if (!thumb && image) thumb = await makeThumb(image);
    const photos = [];
    for (const n of o.photoFiles || []) photos.push(await zip.blob(n));
    const rec = { ...o, thumb, hasImage: !!image, photoCount: photos.length };
    delete rec.imageFile; delete rec.thumbFile; delete rec.photoFiles;
    await DB.saveTicket(rec, { image, photos });
    onProgress?.(++i, data.tickets.length);
  }
}
