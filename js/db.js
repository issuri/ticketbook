// IndexedDB 저장소. 티켓 메타데이터+썸네일은 'tickets', 원본 이미지/추가 사진은 'blobs'에 따로 둡니다.
// (목록 화면이 큰 원본을 읽지 않아도 되도록 분리)
const DB_NAME = 'ticketbook';
const DB_VERSION = 1;
let dbPromise;

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('tickets', { keyPath: 'id' });
      db.createObjectStore('books', { keyPath: 'id' });
      db.createObjectStore('blobs');
      db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// fn(tx) 안에서 요청을 만들고, 마지막 요청을 반환하면 그 결과값을 돌려줍니다.
async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const req = fn(tx);
    tx.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('저장 중단됨'));
  });
}

export const getAll = (store) => run(store, 'readonly', (tx) => tx.objectStore(store).getAll());
export const putBook = (book) => run('books', 'readwrite', (tx) => tx.objectStore('books').put(book));
export const deleteBook = (id) => run('books', 'readwrite', (tx) => tx.objectStore('books').delete(id));

export const putTicket = (rec) => run('tickets', 'readwrite', (tx) => tx.objectStore('tickets').put(rec));

export const saveTicket =(rec, { image, photos }) =>
  run(['tickets', 'blobs'], 'readwrite', (tx) => {
    tx.objectStore('tickets').put(rec);
    return tx.objectStore('blobs').put({ image: image || null, photos: photos || [] }, rec.id);
  });

export const getBlobs = async (id) =>
  (await run('blobs', 'readonly', (tx) => tx.objectStore('blobs').get(id))) || { image: null, photos: [] };

export const deleteTicket = (id) =>
  run(['tickets', 'blobs'], 'readwrite', (tx) => {
    tx.objectStore('tickets').delete(id);
    return tx.objectStore('blobs').delete(id);
  });

export const clearAll = () =>
  run(['tickets', 'books', 'blobs'], 'readwrite', (tx) => {
    tx.objectStore('tickets').clear();
    tx.objectStore('books').clear();
    return tx.objectStore('blobs').clear();
  });

export const metaGet = (key) => run('meta', 'readonly', (tx) => tx.objectStore('meta').get(key));
export const metaSet = (key, value) => run('meta', 'readwrite', (tx) => tx.objectStore('meta').put(value, key));
