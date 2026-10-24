// 앱 파일을 기기에 저장해 오프라인에서도 실행되게 합니다. (사용자 데이터는 IndexedDB에 있고 여기엔 없음)
// 앱 코드를 수정해 다시 올릴 때는 VERSION 숫자를 올리세요.
const VERSION = 'v15';
const CACHE = `ticketbook-${VERSION}`;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/db.js', 'js/image.js', 'js/zip.js', 'js/backup.js', 'js/ocr.js', 'js/deco.js', 'js/crop.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== CACHE + '-fonts').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// 같은 출처 요청: 캐시 먼저, 뒤에서 새 버전을 받아 다음 실행에 반영
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // 글꼴(Google Fonts)은 처음 한 번 받아 두면 이후 오프라인에서도 보이게 캐시
  if (req.method === 'GET' && /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.open(CACHE + '-fonts').then(async (cache) => {
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => { cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
});
