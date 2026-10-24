import * as DB from './db.js';
import { processImage } from './image.js';
import { createBackup, inspectBackup, restoreBackup } from './backup.js';
import { recognize, parseTicketText } from './ocr.js';
import { layerFor, rotOf, startEditor, renderDecoPng } from './deco.js';
import { openCropper } from './crop.js';

/* ───────── 상수 ───────── */
const TYPES = {
  show:    { label: '공연',   emoji: '🎭', people: '출연자 · 아티스트', ph: '예: 아이유 / 뮤지컬 배우' },
  sports:  { label: '스포츠', emoji: '⚾', people: '경기 팀',           ph: '예: 두산 vs LG' },
  movie:   { label: '영화',   emoji: '🎬', people: '감독 · 출연',       ph: '예: 감독, 배우' },
  exhibit: { label: '전시',   emoji: '🖼️', people: '작가 · 주최',       ph: '예: 작가명' },
  etc:     { label: '기타',   emoji: '🎫', people: '관련 정보',         ph: '예: 항공편명, 관광지' },
};
const STYLES = { cream: '크림', kraft: '크래프트', blush: '블러시', sage: '세이지', sky: '스카이', ink: '잉크' };
const COVER_COLORS = ['#8c3b2a', '#2f4a5c', '#4b5d3a', '#5a3e5c', '#3b3430', '#b0793a'];
const COVER_EMOJIS = ['🎫', '🎭', '⚾', '🎬', '🖼️', '✈️', '🎵', '📖'];
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/* ───────── 상태 ───────── */
const S = {
  tickets: [], books: [], customs: [], bg: { color: null, image: null, veil: 55 }, bookId: null,
  type: 'all', year: 'init', month: 'init', sort: 'new', q: '',
  page: '', scroll: 0, navIds: [], dir: 0, nudgeHidden: false,
};
let F = null; // 등록/수정 폼 상태
const view = document.getElementById('view');
const overlay = document.getElementById('overlay');

/* ───────── 유틸 ───────── */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = (s) => {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return `${y}.${pad(m)}.${pad(d)} (${WEEK[new Date(y, m - 1, d).getDay()]})`;
};
const fmtShort = (s) => (s ? s.replaceAll('-', '.') : '');
const yearOf = (t) => (t.date ? t.date.slice(0, 4) : '날짜 없음');
const urls = new WeakMap();
const blobUrl = (b) => { if (!b) return ''; if (!urls.has(b)) urls.set(b, URL.createObjectURL(b)); return urls.get(b); };
// 앱 배경: 색 프리셋(라이트/다크 따로) 또는 갤러리 사진. 사진은 글자가 읽히도록 베일(veil)을 덮는다.
const BG_PRESETS = {
  pink: { name: '핑크', l: '#ffe3ee', d: '#2d1823' },
  mint: { name: '민트', l: '#dcf5e8', d: '#13271e' },
  sky: { name: '하늘', l: '#dcecff', d: '#13233a' },
  butter: { name: '버터', l: '#fff1c9', d: '#2b2412' },
  gray: { name: '그레이', l: '#ececf0', d: '#1c1c20' },
};
const darkMq = matchMedia('(prefers-color-scheme: dark)');
function applyBackground() {
  const b = S.bg, root = document.documentElement.style;
  root.removeProperty('--bg'); root.removeProperty('--bg-img'); root.removeProperty('--veil');
  document.body.classList.toggle('has-bg', !!b.image);
  if (b.image) {
    root.setProperty('--bg-img', `url("${blobUrl(b.image)}")`);
    root.setProperty('--veil', `${b.veil ?? 55}%`);
  } else if (BG_PRESETS[b.color]) {
    root.setProperty('--bg', darkMq.matches ? BG_PRESETS[b.color].d : BG_PRESETS[b.color].l);
  }
}
darkMq.addEventListener?.('change', () => applyBackground());

// 사용자가 만든 종류(좋아하는 아티스트·선수 등). 기본 종류와 같은 모양으로 다룬다.
const customOf = (id) => {
  const c = S.customs.find((x) => x.id === id);
  return c ? { label: c.name, emoji: c.emoji || '⭐', people: '관련 정보', ph: '예: 멤버, 공연명, 선수', custom: true, color: c.color, photo: c.photo } : null;
};
const typeOf = (k) => TYPES[k] || customOf(k) || TYPES.etc;
const tintStyle = (k) => { const ty = typeOf(k); return ty.custom ? `--tint:${ty.color};` : ''; };
const typeIcon = (ty) => (ty.photo ? `<img class="tico" src="${blobUrl(ty.photo)}" alt="">` : `<span class="tico">${esc(ty.emoji)}</span>`);
const onColor = (color) => ` style="background:${color};color:#1d1740"`;
const CUSTOM_COLORS = ['#bfaeff', '#8fe3b4', '#ff9f86', '#8cc8ff', '#ffd66b', '#ff9ec4', '#a5e86b', '#ffb86b'];
const CUSTOM_EMOJIS = ['🎤', '🎧', '⚽', '⚾', '🏀', '🏐', '🎬', '🎹', '🎸', '⭐', '💜', '🏟️'];
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const goBack = (fallback = '#/') => { if (history.length > 1) history.back(); else location.hash = fallback; };

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function openSheet(html, { onClose } = {}) {
  closeOverlay();
  const wrap = document.createElement('div');
  wrap.className = 'backdrop';
  wrap.innerHTML = `<div class="sheet" role="dialog">${html}</div>`;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) { closeOverlay(); onClose?.(); } });
  overlay.appendChild(wrap);
  return wrap.firstElementChild;
}
function closeOverlay() { overlay.innerHTML = ''; }

function confirmBox(title, msg, okLabel = '확인', danger = false) {
  return new Promise((resolve) => {
    const sh = openSheet(`<h3>${esc(title)}</h3><p class="muted">${esc(msg)}</p>
      <div class="row end"><button class="btn ghost" data-r="0">취소</button>
      <button class="btn ${danger ? 'danger' : ''}" data-r="1">${esc(okLabel)}</button></div>`, { onClose: () => resolve(false) });
    sh.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (b) { closeOverlay(); resolve(b.dataset.r === '1'); }
    });
  });
}

function openLightbox(url) {
  const wrap = document.createElement('div');
  wrap.className = 'lightbox';
  wrap.innerHTML = `<img src="${url}" alt=""><button class="lb-x" aria-label="닫기">✕</button>`;
  wrap.addEventListener('click', closeOverlay);
  closeOverlay(); overlay.appendChild(wrap);
}

/* ───────── 데이터 ───────── */
async function markChanged() {
  const n = ((await DB.metaGet('changes')) || 0) + 1;
  await DB.metaSet('changes', n);
}

async function loadAll() {
  const [tickets, books] = await Promise.all([DB.getAll('tickets'), DB.getAll('books')]);
  S.tickets = tickets;
  S.books = books.sort((a, b) => a.createdAt - b.createdAt);
  if (!S.books.length) {
    const b = { id: DB.uid(), name: '티모아', color: COVER_COLORS[0], emoji: '🎫', cover: null, createdAt: Date.now() };
    await DB.putBook(b); S.books = [b];
  }
  // 예전 기본 이름("나의 티켓북")을 앱 이름으로 바꿈 (직접 이름을 고친 티켓북은 그대로 둠)
  for (const b of S.books) if (b.name === '나의 티켓북') { b.name = '티모아'; await DB.putBook(b); }
  S.customs = (await DB.metaGet('customTypes')) || [];
  S.bg = (await DB.metaGet('background')) || { color: null, image: null, veil: 55 };
  applyBackground();
  const saved = await DB.metaGet('currentBook');
  S.bookId = S.books.some((b) => b.id === saved) || saved === 'all' ? saved : S.books[0].id;
}

function currentBook() {
  if (S.bookId === 'all') return { id: 'all', name: '모든 티켓북', color: '#3b3430', emoji: '📚', cover: null };
  return S.books.find((b) => b.id === S.bookId) || S.books[0];
}

const bookTickets = () => (S.bookId === 'all' ? S.tickets : S.tickets.filter((t) => t.bookId === S.bookId));

function cmp(a, b) {
  return (a.date || '').localeCompare(b.date || '') || a.createdAt - b.createdAt;
}

function filtered() {
  let a = bookTickets();
  if (S.type !== 'all') a = a.filter((t) => t.type === S.type);
  if (S.year !== 'all') a = a.filter((t) => yearOf(t) === S.year);
  if (S.month !== 'all') a = a.filter((t) => t.date && +t.date.slice(5, 7) === S.month);
  const q = S.q.trim().toLowerCase();
  if (q) {
    a = a.filter((t) => [t.title, t.place, t.people, t.companions, t.seat, t.review, typeOf(t.type).label]
      .some((v) => (v || '').toLowerCase().includes(q)));
  }
  a = [...a].sort(cmp);
  if (S.sort === 'new') a.reverse();
  return a;
}

/* ───────── 라우터 ───────── */
async function route() {
  const parts = (location.hash.slice(1) || '/').split('/');
  const a = parts[1] || '', b = parts[2];
  if (S.page === 'home') S.scroll = a === 'ticket' ? window.scrollY : 0;
  closeOverlay();
  clearPageGrad();
  view.removeAttribute('style');
  document.body.dataset.page = a === 'settings' ? 'settings' : a === '' ? 'home' : 'full';
  if (a === '') renderHome();
  else if (a === 'ticket') await renderDetail(b);
  else if (a === 'new') await renderForm(null);
  else if (a === 'edit') await renderForm(b);
  else if (a === 'settings') await renderSettings(b);
  else location.replace('#/');
  renderTabbar();
}

function renderTabbar() {
  const p = document.body.dataset.page;
  const book = '<svg viewBox="0 0 24 24"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v15H5.5A1.5 1.5 0 0 0 4 20.5z"/><path d="M4 20.5A1.5 1.5 0 0 1 5.5 19H19"/></svg>';
  const box = '<svg viewBox="0 0 24 24"><path d="M3.5 8h17v11.5h-17z"/><path d="M3.5 8 6 4.5h12L20.5 8"/><path d="M9.5 12.5h5"/></svg>';
  document.getElementById('tabbar').innerHTML = `
    <a href="#/" class="${p === 'home' ? 'on' : ''}">${book}티켓북</a>
    <a href="#/new" class="plus" aria-label="티켓 추가"><b><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></b></a>
    <a href="#/settings" class="${p === 'settings' ? 'on' : ''}">${box}보관함</a>`;
}


/* ───────── 카드 ───────── */
function placeholder(t) {
  return `<div class="ph dbase"><span>${typeOf(t.type).emoji}</span><b>${esc(t.title || '제목 없음')}</b><small>${esc(fmtShort(t.date))}</small></div>`;
}

// 꾸미기 상자: 이미지가 있으면 이미지, 없으면 제목·날짜가 적힌 기본 카드 위에 꾸밈을 얹는다 (모든 티켓에서 꾸미기 가능)
function dtkHtml(t, base, extra = '') {
  return `<div class="dtk f-${t.deco?.frame || 'none'}"${extra}>${base}<div class="dlayer">${layerFor(t)}</div></div>`;
}

// ── NOL 티켓 스타일: 위=포스터(이미지) / 가운데=절취선 / 아래=제목·장소 + 큰 날짜 ──
const PERF = '<div class="tperf"><span>TIMOA</span></div>';

// 이미지가 포스터 칸을 못 채워도 빈 곳이 없도록, 같은 이미지를 흐리게 깔아 둔다
const posterBg = (src) => `<div class="pbgw">${src ? `<img class="pbg" src="${src}" alt="" aria-hidden="true">` : ''}</div>`;

function infoHtml(t, ty, big = false) {
  const [y, m, d] = t.date ? t.date.split('-') : [];
  return `<div class="tinfo${big ? ' big' : ''}">
    <div class="tl"><em class="ttype">${esc(ty.label)}</em><b>${esc(t.title || '제목 없음')}</b>${t.place ? `<small>${esc(t.place)}</small>` : ''}</div>
    ${t.date ? `<div class="td"><strong>${m}</strong><strong>${d}</strong><small>${y}</small></div>` : ''}
  </div>`;
}

function cardHtml(t, i) {
  const ty = typeOf(t.type);
  const dtk = dtkHtml(t, t.thumb ? `<img class="dbase" src="${blobUrl(t.thumb)}" alt="${esc(t.title)}" loading="lazy">` : placeholder(t));
  return `<a class="tcard nol ty-${t.type} paper-${t.style || 'cream'}" href="#/ticket/${t.id}" style="${tintStyle(t.type)}--rot:${rotOf(t.id)}deg;--i:${Math.min(i, 10)}">
    <div class="tpart1"><div class="timg">${posterBg(t.thumb ? blobUrl(t.thumb) : '')}${dtk}</div></div>
    ${PERF}${infoHtml(t, ty)}
  </a>`;
}

// 상세 화면 배경: 이미지의 평균 색으로 만든 위→아래 그라데이션 (이미지 안 쓰는 칸 없이 화면 전체가 티켓 색으로 채워짐)
async function avgColor(blob) {
  try {
    const url = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    URL.revokeObjectURL(url);
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 16, 16);
    const px = g.getImageData(0, 0, 16, 16).data;
    // 색이 선명한 픽셀일수록 비중을 크게 해서, 흰 글씨 영역·검은 여백에 묻히지 않고 포스터의 대표색이 나오게 함
    const pick = (skipExtremes) => {
      let r = 0, gg = 0, b = 0, n = 0, wsum = 0;
      for (let i = 0; i < px.length; i += 4) {
        const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (skipExtremes && (l < 30 || l > 235)) continue;
        const sat = Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]);
        const w = (sat + 8) ** 2;
        r += px[i] * w; gg += px[i + 1] * w; b += px[i + 2] * w; wsum += w; n++;
      }
      return n >= 12 ? [r / wsum, gg / wsum, b / wsum] : null;
    };
    return pick(true) || pick(false);
  } catch { return null; }
}
const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
function applyPageGrad(rgb) {
  if (!rgb) return;
  const mix = (c, k, to) => c.map((v, i) => Math.round(v + (to[i] - v) * k));
  let base = rgb;
  const lum = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2];
  if (lum < 70) base = mix(base, 0.35, [255, 255, 255]);
  if (lum > 200) base = mix(base, 0.3, [0, 0, 0]);
  document.body.style.setProperty('--grad', `linear-gradient(180deg, rgb(${mix(base, 0.1, [255, 255, 255])}) 0%, rgb(${mix(base, 0.62, [0, 0, 0])}) 100%)`);
  document.body.classList.add('detail-grad');
}
function clearPageGrad() { document.body.classList.remove('detail-grad'); document.body.style.removeProperty('--grad'); }

/* ───────── 홈 ───────── */
function renderHome() {
  S.page = 'home';
  const book = currentBook();
  const bt = bookTickets();
  view.className = 'home';
  view.innerHTML = `
    <div id="nudge"></div>
    <header class="mast">
      <button class="booktitle" data-act="books" aria-label="티켓북 바꾸기">
        <span class="bcover" style="--cv:${book.color}">${book.cover ? `<img src="${blobUrl(book.cover)}" alt="">` : esc(book.emoji || '🎫')}</span>
        <h1>${esc(book.name)}</h1>
        <svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div class="total" aria-label="수집한 티켓 수"><b id="covercount">${bt.length}</b><span>장 모았어요</span></div>
    </header>
    <div class="toolbar">
      <div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/></svg><input id="q" type="search" placeholder="티켓 찾기" value="${esc(S.q)}" enterkeyhint="search"></div>
      <button class="tool" data-act="sort" title="정렬"></button>
    </div>
    <div id="chips"></div>
    <div id="list"></div>`;
  document.getElementById('q').addEventListener('input', (e) => { S.q = e.target.value; updateList(); });
  updateList();
  renderNudge();
  view.classList.add('intro'); // 스티커가 차례로 붙는 입장 모션 (홈을 열 때 한 번)
  setTimeout(() => view.classList.remove('intro'), 1400);
  window.scrollTo(0, S.scroll || 0);
  S.scroll = 0;
}

async function renderNudge() {
  const el = document.getElementById('nudge');
  if (!el || S.nudgeHidden || S.tickets.length < 3) return;
  const [last, changes] = [await DB.metaGet('lastBackup'), (await DB.metaGet('changes')) || 0];
  const days = last ? (Date.now() - last) / 86400000 : Infinity;
  if (days < 30 && changes < 10) return;
  if (!document.getElementById('nudge')) return;
  el.innerHTML = `<div class="nudge"><span>💾 ${last ? `마지막 백업이 ${Math.floor(days)}일 전이에요.` : '아직 백업한 적이 없어요.'} 소중한 기록은 파일로 보관해 두세요.</span>
    <a href="#/settings/backup">백업하기</a><button data-act="hidenudge" aria-label="닫기">✕</button></div>`;
}

function updateList() {
  const bt = bookTickets();
  // 연도 기본값: 올해(티켓이 없으면 가장 최근 연도). 사용자가 "전체 연도"를 누르면 그대로 유지
  if (S.year === 'init') {
    const ys = new Set(bt.map(yearOf));
    const thisYear = String(new Date().getFullYear());
    S.year = ys.has(thisYear) ? thisYear : ([...ys].filter((y) => /^\d+$/.test(y)).sort().pop() || 'all');
  }
  if (S.type !== 'all' && !TYPES[S.type] && !customOf(S.type)) S.type = 'all';
  // 월 선택지: 선택한 연도 안에서 티켓이 있는 달만
  const months = [...new Set(bt.filter((t) => t.date && (S.year === 'all' || yearOf(t) === S.year)).map((t) => +t.date.slice(5, 7)))].sort((a, b) => a - b);
  // 월 기본값: 이번 달(그 달 티켓이 없으면 선택한 연도에서 가장 최근 달)
  if (S.month === 'init') {
    const cur = new Date().getMonth() + 1;
    S.month = months.includes(cur) ? cur : (months[months.length - 1] ?? 'all');
  }
  if (S.month !== 'all' && !months.includes(S.month)) S.month = 'all';
  const list = filtered();
  S.navIds = list.map((t) => t.id);
  const el = (id) => document.getElementById(id);
  if (!el('list')) return;

  // 상단 요약
  el('covercount').textContent = bt.length;
  view.querySelector('[data-act=sort]').textContent = S.sort === 'new' ? '최신순' : '오래된순';
  view.querySelector('.toolbar').style.display = bt.length ? '' : 'none';

  // 필터 칩
  const counts = {};
  bt.forEach((t) => { counts[t.type] = (counts[t.type] || 0) + 1; });
  const years = [...new Set(bt.map(yearOf))].sort().reverse();
  let chips = `<div class="chips">
    <button class="chip ${S.type === 'all' ? 'on' : ''}" data-type="all">전체<i>${bt.length}</i></button>`;
  for (const [k, v] of Object.entries(TYPES)) {
    if (counts[k] || S.type === k) chips += `<button class="chip ${S.type === k ? 'on' : ''}" data-type="${k}">${v.label}<i>${counts[k] || 0}</i></button>`;
  }
  for (const c of S.customs) {
    const on = S.type === c.id;
    chips += `<button class="chip ${on ? 'on' : ''}" data-type="${c.id}"${on ? onColor(c.color) : ''}>${typeIcon(customOf(c.id))}${esc(c.name)}<i>${counts[c.id] || 0}</i></button>`;
  }
  chips += '</div>';
  if (years.length >= 2) {
    chips += `<div class="chips small"><button class="chip ${S.year === 'all' ? 'on' : ''}" data-year="all">전체 연도</button>${years.map((y) =>
      `<button class="chip ${S.year === y ? 'on' : ''}" data-year="${y}">${y}</button>`).join('')}</div>`;
  }
  if (months.length >= 2) {
    chips += `<div class="chips small"><button class="chip ${S.month === 'all' ? 'on' : ''}" data-month="all">전체 월</button>${months.map((m) =>
      `<button class="chip ${S.month === m ? 'on' : ''}" data-month="${m}">${m}월</button>`).join('')}</div>`;
  }
  // 칩을 다시 그려도 가로 스크롤 위치를 유지하고, 선택한 칩이 가려져 있으면 보이는 곳까지만 옮긴다
  const prevScroll = [...el('chips').querySelectorAll('.chips')].map((r) => r.scrollLeft);
  el('chips').innerHTML = bt.length ? chips : '';
  el('chips').querySelectorAll('.chips').forEach((row, i) => {
    row.scrollLeft = prevScroll[i] || 0;
    const on = row.querySelector('.chip.on');
    if (on) {
      const r = row.getBoundingClientRect(), c = on.getBoundingClientRect();
      if (c.right > r.right - 8) row.scrollLeft += c.right - r.right + 16;
      else if (c.left < r.left + 8) row.scrollLeft -= r.left - c.left + 16;
    }
  });

  // 목록
  if (!bt.length) {
    el('list').innerHTML = `<div class="empty">
      <div class="empty-ticket"><b>첫 티켓</b><span>여기에 붙여요</span></div>
      <h2>아직 붙인 티켓이 없어요</h2>
      <p>영화관, 공연장, 경기장에서 받은 모바일 티켓을<br>스크린샷으로 올려 첫 추억을 남겨 보세요.</p>
      <a class="btn big" href="#/new">첫 티켓 붙이기</a>
      ${!isStandalone() && /iphone|ipad/i.test(navigator.userAgent) ? '<p class="hint">💡 Safari 공유 버튼 → "홈 화면에 추가"를 하면 앱처럼 쓸 수 있어요.</p>' : ''}
    </div>`;
    return;
  }
  if (!list.length) {
    el('list').innerHTML = `<div class="empty small"><h2>찾는 티켓이 없어요</h2><p>검색어나 필터를 바꿔 보세요.</p>
      <button class="btn ghost" data-act="resetfilter">필터 모두 해제</button></div>`;
    return;
  }
  // 월별로 묶고, 한 달 안의 티켓은 가로로 넘겨 본다 (아래로 쌓지 않음)
  const groups = new Map();
  list.forEach((t) => { const k = t.date ? t.date.slice(0, 7) : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
  el('list').innerHTML = [...groups].map(([k, arr]) => {
    const [y, m] = k.split('-');
    return `<h3 class="monthhead">${k ? `<b>${+m}월</b><small>${y}</small>` : '<b>날짜 없음</b>'}<span class="mcount">${arr.length}장</span></h3>
      <div class="rail"><div class="track" role="list">${arr.map(cardHtml).join('')}</div>${arr.length > 1 ? '<div class="prog" aria-hidden="true"><i></i></div>' : ''}</div>`;
  }).join('');
  requestAnimationFrame(() => view.querySelectorAll('.track').forEach(updateRail));
}

// 가로 레일: 가운데에 온 카드는 커지고 똑바로, 멀어질수록 작아지고 기울어짐 + 진행 막대와 "2 / 4" 표시
const railPending = new Set();
let railTick = false;
function updateRail(track) {
  const cards = [...track.children];
  const mid = track.scrollLeft + track.clientWidth / 2;
  let best = 0, bestD = Infinity;
  cards.forEach((c, i) => {
    const d = (c.offsetLeft + c.offsetWidth / 2 - mid) / c.offsetWidth;
    const cl = Math.max(-1.6, Math.min(1.6, d));
    c.style.setProperty('--d', cl.toFixed(3));
    c.style.setProperty('--a', Math.abs(cl).toFixed(3));
    if (Math.abs(d) < bestD) { bestD = Math.abs(d); best = i; }
  });
  const rail = track.parentElement;
  const thumb = rail.querySelector('.prog i');
  if (thumb) {
    const max = track.scrollWidth - track.clientWidth;
    const w = Math.max(16, 100 / cards.length);
    thumb.style.width = `${w}%`;
    thumb.style.left = `${(max > 0 ? track.scrollLeft / max : 0) * (100 - w)}%`;
  }
  const cnt = rail.previousElementSibling?.querySelector('.mcount');
  if (cnt && cards.length > 1) cnt.textContent = `${best + 1} / ${cards.length}`;
}
view.addEventListener('scroll', (e) => {
  if (!e.target.classList?.contains('track')) return;
  railPending.add(e.target);
  if (railTick) return;
  railTick = true;
  requestAnimationFrame(() => { railTick = false; railPending.forEach(updateRail); railPending.clear(); });
}, true);

/* ───────── 티켓북(책) 관리 ───────── */
function openBooks() {
  const row = (b, active) => `<div class="bookrow ${active ? 'on' : ''}" data-pick="${b.id}">
    <span class="bdot" style="background:${b.color}">${b.cover ? `<img src="${blobUrl(b.cover)}" alt="">` : esc(b.emoji || '🎫')}</span>
    <span class="bname">${esc(b.name)}<small>${S.tickets.filter((t) => t.bookId === b.id).length}장</small></span>
    ${b.id !== 'all' ? `<button class="icon-btn sm" data-editbook="${b.id}" aria-label="편집">✎</button>` : ''}</div>`;
  const sh = openSheet(`<h3>티켓북 고르기</h3>
    <div class="booklist">${row({ id: 'all', name: '모든 티켓북', color: '#3b3430', emoji: '📚' }, S.bookId === 'all').replace(/(\d+)장/, S.tickets.length + '장')}
    ${S.books.map((b) => row(b, b.id === S.bookId)).join('')}</div>
    <button class="btn ghost wide" data-newbook>＋ 새 티켓북 만들기</button>`);
  sh.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-editbook]');
    if (ed) return editBook(S.books.find((b) => b.id === ed.dataset.editbook));
    if (e.target.closest('[data-newbook]')) return editBook(null);
    const p = e.target.closest('[data-pick]');
    if (p) {
      S.bookId = p.dataset.pick; S.type = 'all'; S.year = 'init'; S.month = 'init';
      await DB.metaSet('currentBook', S.bookId);
      closeOverlay(); renderHome();
    }
  });
}

function editBook(book) {
  const B = book ? { ...book } : { id: DB.uid(), name: '', color: COVER_COLORS[S.books.length % COVER_COLORS.length], emoji: '🎫', cover: null, createdAt: Date.now() };
  const sh = openSheet(`<h3>${book ? '티켓북 꾸미기' : '새 티켓북'}</h3>
    <label class="fld">이름<input id="b-name" maxlength="30" placeholder="예: 2025 공연 모음" value="${esc(B.name)}"></label>
    <div class="fld">표지 색<div class="swatches" id="b-colors">${COVER_COLORS.map((c) =>
      `<button type="button" class="sw ${c === B.color ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div></div>
    <div class="fld">표지 아이콘<div class="swatches" id="b-emojis">${COVER_EMOJIS.map((e) =>
      `<button type="button" class="sw em ${e === B.emoji ? 'on' : ''}" data-e="${e}">${e}</button>`).join('')}</div></div>
    <div class="fld">표지 사진 (선택)<div class="row"><button type="button" class="btn ghost" id="b-pick">사진 고르기</button>
      <button type="button" class="btn ghost" id="b-clear" ${B.cover ? '' : 'hidden'}>사진 빼기</button></div>
      <input type="file" id="b-file" accept="image/*" hidden></div>
    <div class="row end">
      ${book && S.books.length > 1 ? '<button class="btn danger ghost" id="b-del">삭제</button>' : ''}
      <button class="btn ghost" id="b-cancel">취소</button><button class="btn" id="b-save">저장</button></div>`);
  const $ = (s) => sh.querySelector(s);
  sh.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-c]'), em = e.target.closest('[data-e]');
    if (c) { B.color = c.dataset.c; sh.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === c)); }
    if (em) { B.emoji = em.dataset.e; sh.querySelectorAll('[data-e]').forEach((x) => x.classList.toggle('on', x === em)); }
  });
  $('#b-pick').onclick = () => $('#b-file').click();
  $('#b-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { B.cover = (await processImage(f)).thumb; $('#b-clear').hidden = false; toast('표지 사진을 골랐어요'); }
    catch (err) { toast(err.message); }
  };
  $('#b-clear').onclick = () => { B.cover = null; $('#b-clear').hidden = true; };
  $('#b-cancel').onclick = openBooks;
  $('#b-save').onclick = async () => {
    B.name = $('#b-name').value.trim() || '이름 없는 티켓북';
    await DB.putBook(B);
    const i = S.books.findIndex((x) => x.id === B.id);
    if (i >= 0) S.books[i] = B; else S.books.push(B);
    if (!book) { S.bookId = B.id; await DB.metaSet('currentBook', B.id); }
    await markChanged();
    closeOverlay(); route();
  };
  if (book && S.books.length > 1) {
    $('#b-del').onclick = async () => {
      const rest = S.books.find((b) => b.id !== book.id);
      const n = S.tickets.filter((t) => t.bookId === book.id).length;
      if (!await confirmBox('티켓북 삭제', `"${book.name}"을(를) 삭제할까요? 안에 있는 티켓 ${n}장은 지워지지 않고 "${rest.name}"(으)로 옮겨져요.`, '삭제', true)) return;
      for (const t of S.tickets.filter((x) => x.bookId === book.id)) { t.bookId = rest.id; await DB.putTicket(t); }
      await DB.deleteBook(book.id);
      S.books = S.books.filter((b) => b.id !== book.id);
      if (S.bookId === book.id) { S.bookId = rest.id; await DB.metaSet('currentBook', rest.id); }
      await markChanged();
      route();
    };
  }
}

/* ───────── 상세 ───────── */
async function renderDetail(id) {
  const t = S.tickets.find((x) => x.id === id);
  if (!t) { location.replace('#/'); return; }
  S.page = 'detail';
  const bl = await DB.getBlobs(id);
  if (S.page !== 'detail' || location.hash !== `#/ticket/${id}`) return; // 로딩 중 이동한 경우
  const ids = S.navIds.includes(id) ? S.navIds : [...S.tickets].sort(cmp).reverse().map((x) => x.id);
  const idx = ids.indexOf(id);
  const ty = typeOf(t.type);
  const book = S.books.find((b) => b.id === t.bookId);
  const rows = [
    [ty.people, t.people], ['좌석', t.seat], ['함께한 사람', t.companions],
  ].filter(([, v]) => v);
  view.className = `detail ty-${t.type} paper-${t.style || 'cream'} ${S.dir > 0 ? 'flip-next' : S.dir < 0 ? 'flip-prev' : ''}`;
  S.dir = 0;
  view.style.cssText = tintStyle(t.type);
  view.innerHTML = `
    <div class="dbar">
      <button class="icon-btn" data-act="back" aria-label="뒤로">‹</button>
      <span class="pager">${idx + 1} / ${ids.length}</span>
      <span><button class="link" data-act="edit" data-id="${id}">수정</button><button class="link danger" data-act="del" data-id="${id}">삭제</button></span>
    </div>
    <article id="dpage">
      <div class="nolcard">
        <div class="tpart1"><figure class="dimg">${posterBg(bl.image ? blobUrl(bl.image) : '')}${dtkHtml(t, bl.image ? `<img class="dbase" src="${blobUrl(bl.image)}" alt="${esc(t.title)}" data-act="zoom">` : placeholder(t), ' id="dtk"')}</figure></div>
        ${PERF}${infoHtml(t, ty, true)}
      </div>
      <div class="dmore">
        <div class="dtools"><button class="btn small" data-act="decorate" data-id="${id}">✨ 꾸미기</button><button class="btn ghost small" data-act="exportimg" data-id="${id}">이미지로 저장</button></div>
        <div class="dmeta">
          ${book && S.books.length > 1 ? `<p class="pills"><span class="typepill soft">${esc(book.name)}</span></p>` : ''}
          ${rows.length ? `<dl>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
          ${t.review ? `<section class="review"><h2>그날의 기록</h2><p>${esc(t.review)}</p></section>` : ''}
          ${bl.photos.length ? `<section><h2>함께 남긴 사진</h2><div class="photos">${bl.photos.map((p) =>
            `<img src="${blobUrl(p)}" alt="" data-act="zoom">`).join('')}</div></section>` : ''}
          <p class="reg">${new Date(t.createdAt).toLocaleDateString('ko-KR')}에 붙인 티켓</p>
        </div>
      </div>
    </article>
    ${idx > 0 ? `<button class="navarrow prev" data-act="nav" data-d="-1" aria-label="앞 장">‹</button>` : ''}
    ${idx < ids.length - 1 ? `<button class="navarrow next" data-act="nav" data-d="1" aria-label="다음 장">›</button>` : ''}`;
  // 티켓 이미지(또는 종류색)로 화면 전체 배경을 채움
  const tintHex = ty.custom ? ty.color : { show: '#bfaeff', sports: '#8fe3b4', movie: '#ff9f86', exhibit: '#8cc8ff', etc: '#ffd66b' }[t.type] || '#bfaeff';
  const rgb = bl.image ? await avgColor(bl.image) : null;
  if (S.page === 'detail' && location.hash === `#/ticket/${id}`) applyPageGrad(rgb || hexRgb(tintHex));
  // 좌우 스와이프로 페이지 넘기기. 목록은 최신순이면 오른쪽 이동 = 더 오래된 티켓
  view._nav = (d) => {
    const n = idx + d;
    if (n < 0 || n >= ids.length) return;
    S.dir = d;
    location.replace(`#/ticket/${ids[n]}`);
  };
  window.scrollTo(0, 0);
}

// 이미지가 로드되면 실제 가로세로 비율을 꾸밈 상자에 알려 준다 (스티커 위치가 이미지 기준 %라서)
view.addEventListener('load', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  const box = img.closest('.dtk');
  if (box && img.naturalHeight) box.style.setProperty('--ar', (img.naturalWidth / img.naturalHeight).toFixed(4));
}, true);

function startDeco(id) {
  const t = S.tickets.find((x) => x.id === id);
  if (!t || !view.querySelector('#dtk')) return;
  window.scrollTo(0, 0);
  startEditor({
    view, ticket: t, confirmFn: confirmBox,
    onDone: async (deco) => {
      if (deco !== false) {
        if (deco) t.deco = deco; else delete t.deco;
        await DB.putTicket(t);
        await markChanged();
        toast('꾸밈을 저장했어요');
      }
      renderDetail(id);
    },
  });
}

// '#rrggbb' 색에 흰색을 섞는다 (이미지 없는 티켓 PNG의 바탕색)
function mixWhite(hex, w) {
  const n = parseInt(hex.slice(1), 16);
  const m = (c) => Math.round(c + (255 - c) * w);
  return `rgb(${m(n >> 16)},${m((n >> 8) & 255)},${m(n & 255)})`;
}

async function exportImage(id) {
  const t = S.tickets.find((x) => x.id === id);
  const sh = openSheet('<h3>이미지 만드는 중…</h3><p class="muted">잠시만 기다려 주세요</p>');
  try {
    const bl = await DB.getBlobs(id);
    const ty = typeOf(t.type);
    const base = ty.custom ? ty.color : { show: '#bfaeff', sports: '#8fe3b4', movie: '#ff9f86', exhibit: '#8cc8ff', etc: '#ffd66b' }[t.type] || '#bfaeff';
    const blob = await renderDecoPng(bl.image, t.deco, { emoji: ty.emoji, title: t.title, date: fmtShort(t.date), bg: mixWhite(base, 0.58), tint: base, id: t.id });
    const file = new File([blob], `ticket-${t.date || today()}.png`, { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    sh.innerHTML = `<h3>꾸민 티켓 이미지</h3>
      <img class="expprev" src="${url}" alt="미리보기">
      <div class="col">
        ${canShare ? '<button class="btn wide" id="ex-share">사진 앱에 저장 / 공유</button>' : ''}
        <a class="btn ${canShare ? 'ghost' : ''} wide" href="${url}" download="${file.name}">다운로드</a>
      </div>
      <p class="muted small">${canShare ? '공유 창에서 "이미지 저장"을 고르면 사진 앱에 들어가요. ' : ''}이미지를 길게 눌러서 저장할 수도 있어요.</p>`;
    sh.querySelector('#ex-share')?.addEventListener('click', async () => {
      try { await navigator.share({ files: [file], title: t.title || '티켓' }); } catch (err) { if (err.name !== 'AbortError') toast('공유에 실패했어요. 다운로드를 이용해 주세요.'); }
    });
  } catch (err) {
    console.error(err); closeOverlay(); toast(err.message || '이미지를 만들지 못했어요.');
  }
}

let touchStart = null;
document.addEventListener('touchstart', (e) => {
  touchStart = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!touchStart || S.page !== 'detail' || overlay.firstChild || view.classList.contains('decoing')) return;
  const dx = e.changedTouches[0].clientX - touchStart.x, dy = e.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 70 && Math.abs(dy) < 60) view._nav?.(dx < 0 ? 1 : -1);
}, { passive: true });

/* ───────── 등록 / 수정 ───────── */
async function renderForm(id) {
  S.page = 'form';
  const t = id ? S.tickets.find((x) => x.id === id) : null;
  if (id && !t) { location.replace('#/'); return; }
  const bl = t ? await DB.getBlobs(id) : { image: null, photos: [] };
  if (S.page !== 'form') return;
  const lastType = (await DB.metaGet('lastType')) || 'show';
  F = {
    id: t?.id || null, type: t?.type || (S.type !== 'all' ? S.type : lastType),
    image: bl.image, thumb: t?.thumb || null, photos: [...bl.photos],
    style: t?.style || 'cream',
    bookId: t?.bookId || (S.bookId !== 'all' ? S.bookId : S.books[0].id),
    created: t?.createdAt, deco: t?.deco,
  };
  const more = !!(t && (t.people || t.seat || t.companions || bl.photos.length));
  view.className = 'form';
  view.innerHTML = `
    <div class="dbar">
      <button class="icon-btn" data-act="cancelform" aria-label="닫기">✕</button>
      <b class="ftitle">${t ? '티켓 수정' : '새 티켓 붙이기'}</b>
      <button class="btn small" data-act="saveform">저장</button>
    </div>
    <div class="fbody">
      <div id="imgarea"></div>
      <input type="file" id="f-gallery" accept="image/*" hidden>
      <input type="file" id="f-camera" accept="image/*" capture="environment" hidden>
      <div id="ocr"></div>

      <div class="fld">종류<div class="chips wrapchips" id="f-types">${typeChipsHtml()}</div></div>
      <label class="fld">제목<input id="f-title" maxlength="80" placeholder="예: 아이유 콘서트 'HEREH'" value="${esc(t?.title)}"></label>
      <div class="two">
        <label class="fld">날짜<input id="f-date" type="date" value="${esc(t?.date ?? today())}"></label>
        <label class="fld">장소<input id="f-place" maxlength="60" placeholder="예: 잠실 주경기장" value="${esc(t?.place)}"></label>
      </div>
      <label class="fld">그날의 기록<textarea id="f-review" rows="5" placeholder="기억하고 싶은 순간, 느낀 점을 적어 보세요">${esc(t?.review)}</textarea></label>

      <details class="more" ${more ? 'open' : ''}><summary>더 기록하기 <small>아티스트 · 좌석 · 동행 · 사진 · 꾸미기</small></summary>
        <label class="fld"><span id="f-peoplelbl"></span><input id="f-people" maxlength="80" value="${esc(t?.people)}"></label>
        <div class="two">
          <label class="fld">좌석<input id="f-seat" maxlength="40" placeholder="예: 1층 B구역 12열 7번" value="${esc(t?.seat)}"></label>
          <label class="fld">함께한 사람<input id="f-comp" maxlength="60" placeholder="예: 민지, 엄마" value="${esc(t?.companions)}"></label>
        </div>
        <div class="fld">티켓과 함께 찍은 사진<div id="f-photos" class="photos edit"></div>
          <button type="button" class="btn ghost" data-act="addphotos">＋ 사진 추가</button>
          <input type="file" id="f-photofile" accept="image/*" multiple hidden></div>
        ${S.books.length > 1 ? `<label class="fld">티켓북<select id="f-book">${S.books.map((b) =>
          `<option value="${b.id}" ${b.id === F.bookId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>` : ''}
        <div class="fld">카드 색<div class="swatches" id="f-styles">${Object.entries(STYLES).map(([k, n]) =>
          `<button type="button" class="sw paper-${k} ${F.style === k ? 'on' : ''}" data-fstyle="${k}" title="${n}"></button>`).join('')}</div></div>
      </details>
    </div>`;
  paintImageArea(); paintPhotos(); paintPeopleLabel();
  const $ = (s) => view.querySelector(s);
  const onFile = (inp) => async () => {
    const f = inp.files[0]; inp.value = ''; if (!f) return;
    $('#imgarea').classList.add('busy');
    try {
      const cropped = await openCropper(f); // 고른 사진을 먼저 자르기 화면에서 다듬음 (null = 취소)
      if (cropped) {
        const r = await processImage(cropped);
        F.image = r.full; F.thumb = r.thumb; paintImageArea();
      }
    } catch (err) { toast(err.message); }
    $('#imgarea').classList.remove('busy');
  };
  $('#f-gallery').onchange = onFile($('#f-gallery'));
  $('#f-camera').onchange = onFile($('#f-camera'));
  $('#f-photofile').onchange = async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    toast('사진 처리 중…');
    for (const f of files) {
      try { F.photos.push((await processImage(f)).full); } catch (err) { toast(err.message); }
    }
    paintPhotos();
  };
  window.scrollTo(0, 0);
}

function typeChipsHtml() {
  const builtin = Object.entries(TYPES).map(([k, v]) =>
    `<button type="button" class="chip ${F.type === k ? 'on' : ''}" data-ftype="${k}">${v.label}</button>`);
  const mine = S.customs.map((c) => {
    const on = F.type === c.id;
    return `<button type="button" class="chip ${on ? 'on' : ''}" data-ftype="${c.id}"${on ? onColor(c.color) : ''}>${typeIcon(customOf(c.id))}${esc(c.name)}</button>`;
  });
  return [...builtin, ...mine, '<button type="button" class="chip add" data-act="newtype">＋ 내 종류 만들기</button>'].join('');
}

function paintTypes() {
  const el = document.getElementById('f-types');
  if (el) el.innerHTML = typeChipsHtml();
}

function paintImageArea() {
  const el = document.getElementById('imgarea'); if (!el) return;
  el.innerHTML = F.image
    ? `<div class="preview"><img src="${blobUrl(F.image)}" alt="티켓 미리보기">
        <div class="row"><button type="button" class="btn ghost small" data-act="pickgallery">다른 이미지</button>
        <button type="button" class="btn ghost small" data-act="cropimage">✂️ 자르기</button>
        <button type="button" class="btn ghost small" data-act="ocr">✨ 글자 읽기 (실험)</button>
        <button type="button" class="btn ghost small" data-act="rmimage">빼기</button></div></div>`
    : `<div class="drop"><div class="drop-ico">🎟️</div><p>티켓 이미지를 붙여 주세요</p>
        <div class="row center"><button type="button" class="btn" data-act="pickgallery">갤러리에서 선택</button>
        <button type="button" class="btn ghost" data-act="pickcamera">📷 촬영</button></div>
        <small>모바일 티켓 캡처, 실물 티켓 사진 모두 가능해요</small></div>`;
}

function paintPhotos() {
  const el = document.getElementById('f-photos'); if (!el) return;
  el.innerHTML = F.photos.map((p, i) => `<div class="ph-item"><img src="${blobUrl(p)}" alt=""><button type="button" data-rmphoto="${i}" aria-label="사진 삭제">✕</button></div>`).join('');
}

function paintPeopleLabel() {
  const ty = typeOf(F.type);
  const lbl = document.getElementById('f-peoplelbl'), inp = document.getElementById('f-people');
  if (lbl) lbl.textContent = ty.people;
  if (inp) inp.placeholder = ty.ph;
}

async function saveForm() {
  const v = (id) => (document.getElementById(id)?.value ?? '').trim();
  const title = v('f-title');
  if (!F.image && !title && !F.photos.length) { toast('이미지를 붙이거나 제목을 적어 주세요'); return; }
  const now = Date.now();
  const rec = {
    id: F.id || DB.uid(), type: F.type, title, date: v('f-date'), place: v('f-place'),
    people: v('f-people'), seat: v('f-seat'), companions: v('f-comp'), review: document.getElementById('f-review').value.trim(),
    bookId: document.getElementById('f-book')?.value || F.bookId, style: F.style,
    thumb: F.thumb, hasImage: !!F.image, photoCount: F.photos.length, ...(F.deco ? { deco: F.deco } : {}),
    createdAt: F.created || now, updatedAt: now,
  };
  try {
    await DB.saveTicket(rec, { image: F.image, photos: F.photos });
  } catch (err) {
    toast('저장하지 못했어요. 저장 공간이 부족할 수 있어요.'); console.error(err); return;
  }
  const i = S.tickets.findIndex((x) => x.id === rec.id);
  if (i >= 0) S.tickets[i] = rec; else S.tickets.push(rec);
  // 방금 저장한 티켓이 홈에서 바로 보이도록, 필터를 그 티켓의 연도·월로 이동
  if (S.bookId !== 'all') S.bookId = rec.bookId;
  S.type = 'all'; S.q = '';
  if (rec.date) { S.year = rec.date.slice(0, 4); S.month = +rec.date.slice(5, 7); } else { S.year = 'all'; S.month = 'all'; }
  await DB.metaSet('lastType', rec.type);
  await markChanged();
  navigator.storage?.persist?.(); // 브라우저가 임의로 지우지 않도록 요청
  toast(F.id ? '수정했어요' : '티켓북에 붙였어요 🎫');
  const wasEdit = !!F.id;
  F = null;
  if (!S.navIds.includes(rec.id)) S.navIds.unshift(rec.id);
  // 수정: 열어 둔 상세 화면으로 되돌아감 / 새 티켓: 등록 화면을 상세 화면으로 교체
  if (wasEdit && history.length > 1) history.back();
  else location.replace(`#/ticket/${rec.id}`);
}

async function runOcr() {
  const box = document.getElementById('ocr');
  box.innerHTML = '<div class="ocr-note">글자 인식 준비 중… (처음에는 인터넷으로 언어 데이터를 내려받아 시간이 걸려요)</div>';
  try {
    const text = await recognize(F.image, (m) => {
      if (m.status) box.innerHTML = `<div class="ocr-note">${esc(m.status)} ${m.progress ? Math.round(m.progress * 100) + '%' : ''}</div>`;
    });
    const { date, lines } = parseTicketText(text);
    if (date) { document.getElementById('f-date').value = date; }
    box.innerHTML = lines.length
      ? `<div class="ocr-res"><p>${date ? `📅 날짜 <b>${fmtShort(date)}</b>를 찾아 채웠어요. ` : ''}입력칸을 누른 뒤, 아래 글자를 누르면 그 칸에 들어가요. 틀린 글자는 직접 고쳐 주세요.</p>
        <div class="chips wrapchips">${lines.map((l) => `<button type="button" class="chip" data-ocrline="${esc(l)}">${esc(l)}</button>`).join('')}</div></div>`
      : '<div class="ocr-note">읽어낸 글자가 없어요. 더 선명한 이미지로 시도해 보세요.</div>';
  } catch (err) {
    box.innerHTML = `<div class="ocr-note err">${esc(err.message || '글자 인식에 실패했어요.')}</div>`;
  }
}

/* ───────── 보관함(설정) ───────── */
async function renderSettings(open) {
  S.page = 'settings';
  const [last, changes] = [await DB.metaGet('lastBackup'), (await DB.metaGet('changes')) || 0];
  let usage = '';
  try { const e = await navigator.storage.estimate(); usage = `${(e.usage / 1048576).toFixed(1)}MB 사용 중`; } catch { /* 일부 브라우저 미지원 */ }
  let persisted = false;
  try { persisted = await navigator.storage.persisted(); } catch { /* ignore */ }
  const photoCount = S.tickets.reduce((n, t) => n + (t.hasImage ? 1 : 0) + (t.photoCount || 0), 0);
  view.className = 'settings';
  view.innerHTML = `
    <h1 class="pagetitle">보관함</h1>
    <section class="card">
      <h2>내 기록</h2>
      <p><b>${S.tickets.length}</b>장의 티켓 · 사진 <b>${photoCount}</b>장 ${usage ? `· ${usage}` : ''}</p>
      <div class="chips wrapchips">${Object.entries(TYPES).map(([k, v]) => `<span class="chip static">${v.emoji} ${v.label} ${S.tickets.filter((t) => t.type === k).length}</span>`).join('')}</div>
    </section>

    <section class="card">
      <h2>내 종류 · 최애</h2>
      <p class="muted small">좋아하는 아티스트나 선수, 모으고 싶은 주제를 나만의 종류로 만들어 두면 티켓을 등록할 때 버튼으로 고를 수 있어요.</p>
      <div class="booklist">${S.customs.map((c) => `
        <button class="bookrow" data-act="edittype" data-id="${c.id}">
          <span class="bdot" style="background:${c.color}">${c.photo ? `<img src="${blobUrl(c.photo)}" alt="">` : esc(c.emoji)}</span>
          <span class="bname">${esc(c.name)}<small>티켓 ${S.tickets.filter((t) => t.type === c.id).length}장</small></span>
          <span class="muted">✎</span></button>`).join('') || '<p class="muted small">아직 없어요. 예: 마마무, 손흥민</p>'}</div>
      <button class="btn ghost" data-act="newtype">＋ 새로 만들기</button>
    </section>

    <section class="card">
      <h2>배경 꾸미기</h2>
      <p class="muted small">색을 고르거나, 갤러리 사진을 배경으로 쓸 수 있어요.</p>
      <div class="bgrow">
        <button class="bgsw ${!S.bg.image && !S.bg.color ? 'on' : ''}" data-bg="default" title="기본" aria-label="기본 배경" style="background:#eeeafd"></button>
        ${Object.entries(BG_PRESETS).map(([k, v]) => `<button class="bgsw ${!S.bg.image && S.bg.color === k ? 'on' : ''}" data-bg="${k}" title="${v.name}" aria-label="${v.name} 배경" style="background:${v.l}"></button>`).join('')}
        <button class="bgsw photo ${S.bg.image ? 'on' : ''}" data-act="bgpick" title="갤러리에서 사진 고르기" aria-label="갤러리에서 사진 고르기"${S.bg.image ? ` style="background-image:url('${blobUrl(S.bg.image)}')"` : ''}>${S.bg.image ? '' : '🖼️'}</button>
      </div>
      ${S.bg.image ? `<label class="fld veil">사진 위 흐림 정도 <b id="veilv">${S.bg.veil}%</b><input id="veil" type="range" min="0" max="90" step="5" value="${S.bg.veil}"></label>
        <button class="btn ghost small" data-act="bgclear">사진 빼기</button>` : '<button class="btn ghost small" data-act="bgpick">🖼️ 갤러리에서 사진 고르기</button>'}
      <input type="file" id="bgfile" accept="image/*" hidden>
    </section>

    <details class="card fold" ${open === 'backup' ? 'open' : ''}>
      <summary>백업과 복원<small>${last ? `${Math.max(0, Math.floor((Date.now() - last) / 86400000))}일 전 백업` : '백업 없음'}${changes ? ` · 변경 ${changes}건` : ''}</small></summary>
      <div class="foldbody">
        <p class="muted">${last ? `마지막 백업: ${new Date(last).toLocaleString('ko-KR')}` : '아직 백업한 적이 없어요.'}</p>
        <p class="muted small">이 앱의 데이터는 <b>이 기기의 브라우저 안</b>에만 저장돼요. 휴대폰 분실·초기화·앱 삭제에 대비해 주기적으로 백업 파일을 만들어 iCloud Drive나 구글 드라이브 등에 보관하세요.</p>
        <div class="row"><button class="btn" data-act="backup">백업 파일 만들기</button>
        <button class="btn ghost" data-act="restore">백업에서 복원</button></div>
        <input type="file" id="restorefile" accept=".zip,application/zip" hidden>
      </div>
    </details>

    <details class="card fold" ${open === 'safety' ? 'open' : ''}>
      <summary>저장 안전 상태<small>${persisted ? '보호 중' : '확인이 필요해요'}</small></summary>
      <div class="foldbody">
        <p>${persisted ? '✅ 브라우저가 이 앱의 데이터를 임의로 지우지 않도록 보호 중이에요.' : '⚠️ 아직 "영구 보관" 보호가 켜지지 않았어요. 아이폰은 <b>홈 화면에 추가해서 사용</b>하면 안전해요.'}</p>
        ${persisted ? '' : '<button class="btn ghost" data-act="persist">영구 보관 요청</button>'}
      </div>
    </details>

    <details class="card fold">
      <summary>안내<small>설치 · 기기 변경 · 저장 한계</small></summary>
      <div class="foldbody">
      <details><summary>📱 홈 화면에 앱처럼 설치하기</summary>
        <p><b>아이폰</b>: Safari로 이 주소를 열고 → 하단 공유 버튼(□↑) → "홈 화면에 추가" → 추가.<br><b>안드로이드</b>: Chrome 메뉴(⋮) → "홈 화면에 추가" 또는 "앱 설치".<br>꼭 <b>Safari</b>(아이폰)에서 설치해야 해요.</p></details>
      <details><summary>🔄 기기를 바꿀 때 데이터 옮기기</summary>
        <p>1) 지금 기기: 보관함 → 백업 파일 만들기 → "파일로 저장"으로 iCloud Drive/구글 드라이브에 저장<br>
        2) 새 기기: 같은 주소를 열어 홈 화면에 추가<br>
        3) 새 기기: 보관함 → 백업에서 복원 → 저장해 둔 zip 선택 → "합치기"<br>
        이전이 끝나기 전에는 예전 기기의 앱을 지우지 마세요.</p></details>
      <details><summary>⚠️ 로컬 저장의 한계</summary>
        <p>• 서버가 없어서 <b>기기끼리 자동 동기화되지 않아요</b>.<br>• 홈 화면 앱을 삭제하거나, Safari에서 "방문 기록 및 웹사이트 데이터 지우기"를 하면 데이터가 사라져요.<br>• 홈 화면에 추가하지 않고 Safari 탭으로만 쓰면 오래 안 열 때 iOS가 데이터를 정리할 수 있어요.<br>• 그래서 <b>백업 파일이 유일한 안전장치</b>예요.</p></details>
      </div>
    </details>
    <p class="foot">TIMOA · 모든 데이터는 내 기기에만 저장됩니다</p>`;
  document.getElementById('bgfile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      toast('배경 사진 처리 중…');
      await setBackground({ color: null, image: (await processImage(f)).full, veil: S.bg.veil ?? 55 });
    } catch (err) { toast(err.message); }
  };
  const veil = document.getElementById('veil');
  if (veil) {
    veil.oninput = () => { S.bg.veil = +veil.value; document.getElementById('veilv').textContent = `${veil.value}%`; document.documentElement.style.setProperty('--veil', `${veil.value}%`); };
    veil.onchange = () => DB.metaSet('background', S.bg);
  }
  document.getElementById('restorefile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (f) startRestore(f);
  };
  window.scrollTo(0, 0);
}

async function startBackup() {
  if (!S.tickets.length && !confirm('티켓이 하나도 없어요. 그래도 백업 파일을 만들까요?')) return;
  const sh = openSheet('<h3>백업 파일 만드는 중…</h3><p class="muted" id="bk-p">준비 중</p>');
  try {
    const blob = await createBackup((i, n) => { const p = document.getElementById('bk-p'); if (p) p.textContent = `${i} / ${n} 파일`; });
    const name = `timoa-backup-${today()}.zip`;
    const file = new File([blob], name, { type: 'application/zip' });
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    const dl = URL.createObjectURL(blob);
    sh.innerHTML = `<h3>백업 파일이 준비됐어요</h3>
      <p class="muted">${name} · ${(blob.size / 1048576).toFixed(1)}MB<br>티켓 ${S.tickets.length}장과 사진이 모두 들어 있어요.</p>
      <div class="col">
        ${canShare ? '<button class="btn wide" id="bk-share">파일로 저장 / 공유 (iCloud Drive, 파일 앱 등)</button>' : ''}
        <a class="btn ${canShare ? 'ghost' : ''} wide" id="bk-dl" href="${dl}" download="${name}">다운로드</a>
      </div>
      <p class="muted small">${canShare ? '"파일에 저장"을 고르면 iCloud Drive에 보관할 수 있어요.' : ''} 저장한 뒤 파일이 실제로 있는지 한 번 확인해 보세요.</p>`;
    const markDone = async () => { await DB.metaSet('lastBackup', Date.now()); await DB.metaSet('changes', 0); };
    sh.querySelector('#bk-dl').onclick = () => { markDone().then(() => setTimeout(() => route(), 800)); };
    const sb = sh.querySelector('#bk-share');
    if (sb) sb.onclick = async () => {
      try { await navigator.share({ files: [file], title: 'TIMOA 백업' }); await markDone(); closeOverlay(); toast('백업을 저장했어요'); route(); }
      catch (err) { if (err.name !== 'AbortError') toast('공유에 실패했어요. 다운로드를 이용해 주세요.'); }
    };
  } catch (err) {
    console.error(err); closeOverlay(); toast('백업 파일을 만들지 못했어요: ' + err.message);
  }
}

async function startRestore(file) {
  let info;
  try { info = await inspectBackup(file); } catch (err) { toast(err.message); return; }
  const n = info.data.tickets.length;
  const when = info.data.exportedAt ? new Date(info.data.exportedAt).toLocaleString('ko-KR') : '알 수 없음';
  const sh = openSheet(`<h3>백업에서 복원</h3>
    <p class="muted">백업 시각: ${when}<br>티켓 <b>${n}</b>장 · 티켓북 ${info.data.books?.length || 0}개</p>
    <div class="col">
      <button class="btn wide" data-m="merge">합치기 <small>지금 데이터는 두고 백업 내용을 추가 (같은 티켓은 백업 기준으로 덮어씀)</small></button>
      <button class="btn ghost wide danger" data-m="replace">모두 바꾸기 <small>지금 데이터를 지우고 백업 그대로 복원</small></button>
      <button class="btn ghost wide" data-m="">취소</button></div>`);
  sh.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    if (!b.dataset.m) return closeOverlay();
    if (b.dataset.m === 'replace' && !await confirmBox('정말 모두 바꿀까요?', '지금 기기의 티켓과 사진이 모두 삭제되고 백업 내용으로 대체돼요. 되돌릴 수 없어요.', '모두 바꾸기', true)) return;
    openSheet('<h3>복원하는 중…</h3><p class="muted" id="rs-p">0 / ' + n + '</p>');
    try {
      await restoreBackup(info, b.dataset.m, (i, t) => { const p = document.getElementById('rs-p'); if (p) p.textContent = `${i} / ${t}`; });
      await loadAll();
      await DB.metaSet('currentBook', S.bookId);
      closeOverlay(); toast(`티켓 ${n}장을 복원했어요`); location.hash = '#/';
    } catch (err) {
      console.error(err); await loadAll(); closeOverlay(); toast('복원 중 오류: ' + err.message);
    }
  });
}

async function setBackground(bg) {
  S.bg = bg;
  await DB.metaSet('background', bg);
  await markChanged();
  applyBackground();
  const y = window.scrollY;
  await renderSettings();
  window.scrollTo(0, y);
}

/* ───────── 내 종류 (좋아하는 아티스트·선수·주제) ───────── */
function refreshAfterTypeChange() {
  if (S.page === 'settings') renderSettings();
  else if (S.page === 'home') updateList();
}

function editCustom(ct, onSaved) {
  const C = ct ? { ...ct } : { id: DB.uid(), name: '', emoji: '⭐', color: CUSTOM_COLORS[S.customs.length % CUSTOM_COLORS.length], photo: null, createdAt: Date.now() };
  const sh = openSheet(`<h3>${ct ? '내 종류 고치기' : '내 종류 만들기'}</h3>
    <p class="muted small">좋아하는 아티스트, 선수, 팀처럼 따로 모으고 싶은 이름을 적어 보세요. 티켓을 등록할 때 종류 버튼으로 나타나요.</p>
    <label class="fld">이름<input id="c-name" maxlength="20" placeholder="예: 마마무, 손흥민, 두산 베어스" value="${esc(C.name)}"></label>
    <div class="fld">아이콘<div class="swatches" id="c-emojis">${CUSTOM_EMOJIS.map((e) =>
      `<button type="button" class="sw em ${e === C.emoji ? 'on' : ''}" data-e="${e}">${e}</button>`).join('')}</div></div>
    <div class="fld">색<div class="swatches" id="c-colors">${CUSTOM_COLORS.map((c) =>
      `<button type="button" class="sw ${c === C.color ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div></div>
    <div class="fld">사진 (선택)<div class="row"><button type="button" class="btn ghost small" id="c-pick">사진 고르기</button>
      <button type="button" class="btn ghost small" id="c-clear" ${C.photo ? '' : 'hidden'}>사진 빼기</button></div>
      <input type="file" id="c-file" accept="image/*" hidden></div>
    <div class="row end">
      ${ct ? '<button class="btn ghost danger" id="c-del">삭제</button>' : ''}
      <button class="btn ghost" id="c-cancel">취소</button><button class="btn" id="c-save">저장</button></div>`);
  const $ = (s) => sh.querySelector(s);
  sh.addEventListener('click', (e) => {
    const c = e.target.closest('[data-c]'), em = e.target.closest('[data-e]');
    if (c) { C.color = c.dataset.c; sh.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === c)); }
    if (em) { C.emoji = em.dataset.e; sh.querySelectorAll('[data-e]').forEach((x) => x.classList.toggle('on', x === em)); }
  });
  $('#c-pick').onclick = () => $('#c-file').click();
  $('#c-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { C.photo = (await processImage(f)).thumb; $('#c-clear').hidden = false; toast('사진을 골랐어요'); } catch (err) { toast(err.message); }
  };
  $('#c-clear').onclick = () => { C.photo = null; $('#c-clear').hidden = true; };
  $('#c-cancel').onclick = closeOverlay;
  $('#c-save').onclick = async () => {
    C.name = $('#c-name').value.trim();
    if (!C.name) { toast('이름을 적어 주세요'); return; }
    const i = S.customs.findIndex((x) => x.id === C.id);
    if (i >= 0) S.customs[i] = C; else S.customs.push(C);
    await DB.metaSet('customTypes', S.customs);
    await markChanged();
    closeOverlay(); onSaved?.(C); refreshAfterTypeChange();
    if (S.page === 'form') paintTypes();
  };
  if (ct) {
    $('#c-del').onclick = async () => {
      const n = S.tickets.filter((t) => t.type === C.id).length;
      if (!await confirmBox('종류 삭제', `"${C.name}" 종류를 삭제할까요? ${n ? `이 종류의 티켓 ${n}장은 지워지지 않고 "기타"로 옮겨져요.` : ''}`, '삭제', true)) return;
      for (const t of S.tickets.filter((x) => x.type === C.id)) { t.type = 'etc'; await DB.putTicket(t); }
      S.customs = S.customs.filter((x) => x.id !== C.id);
      await DB.metaSet('customTypes', S.customs);
      if (S.type === C.id) S.type = 'all';
      if (F?.type === C.id) F.type = 'etc';
      await markChanged();
      refreshAfterTypeChange();
      if (S.page === 'form') { paintTypes(); paintPeopleLabel(); }
    };
  }
}

/* ───────── 이벤트 ───────── */
const acts = {
  decorate: (el) => startDeco(el.dataset.id),
  exportimg: (el) => exportImage(el.dataset.id),
  newtype: () => editCustom(null, (c) => { if (S.page === 'form' && F) { F.type = c.id; paintPeopleLabel(); } }),
  edittype: (el) => editCustom(S.customs.find((c) => c.id === el.dataset.id)),
  books: openBooks,
  sort: () => { S.sort = S.sort === 'new' ? 'old' : 'new'; updateList(); },
  resetfilter: () => { S.q = ''; S.type = 'all'; S.year = 'all'; S.month = 'all'; const q = document.getElementById('q'); if (q) q.value = ''; updateList(); },
  hidenudge: () => { S.nudgeHidden = true; document.getElementById('nudge').innerHTML = ''; },
  back: () => goBack('#/'),
  edit: (el) => { location.hash = `#/edit/${el.dataset.id}`; },
  del: async (el) => {
    const t = S.tickets.find((x) => x.id === el.dataset.id);
    if (!await confirmBox('티켓 삭제', `"${t.title || '제목 없음'}" 티켓과 기록, 사진이 영구 삭제돼요. 되돌릴 수 없어요.`, '삭제', true)) return;
    await DB.deleteTicket(t.id);
    S.tickets = S.tickets.filter((x) => x.id !== t.id);
    S.navIds = S.navIds.filter((x) => x !== t.id);
    await markChanged();
    toast('삭제했어요');
    location.replace('#/');
  },
  zoom: (el) => openLightbox(el.src),
  nav: (el) => view._nav?.(+el.dataset.d),
  pickgallery: () => document.getElementById('f-gallery').click(),
  pickcamera: () => document.getElementById('f-camera').click(),
  rmimage: () => { F.image = null; F.thumb = null; paintImageArea(); document.getElementById('ocr').innerHTML = ''; },
  ocr: runOcr,
  cropimage: async () => {
    if (!F?.image) return;
    document.getElementById('imgarea').classList.add('busy');
    try {
      const cropped = await openCropper(F.image);
      if (cropped) { const r = await processImage(cropped); F.image = r.full; F.thumb = r.thumb; paintImageArea(); toast('자른 사진으로 바꿨어요'); }
    } catch (err) { toast(err.message); }
    document.getElementById('imgarea')?.classList.remove('busy');
  },
  addphotos: () => document.getElementById('f-photofile').click(),
  saveform: saveForm,
  cancelform: async () => {
    const dirty = F && (F.image || document.getElementById('f-title').value.trim() || document.getElementById('f-review').value.trim());
    if (dirty && !F.id && !await confirmBox('작성을 그만둘까요?', '입력한 내용은 저장되지 않아요.', '그만두기', true)) return;
    F = null; goBack('#/');
  },
  backup: startBackup,
  restore: () => document.getElementById('restorefile').click(),
  persist: async () => {
    const ok = await navigator.storage?.persist?.();
    toast(ok ? '영구 보관이 켜졌어요' : '브라우저가 거절했어요. 홈 화면에 추가한 뒤 다시 시도해 보세요.');
    renderSettings('safety');
  },
  bgpick: () => document.getElementById('bgfile').click(),
  bgclear: () => setBackground({ color: null, image: null, veil: S.bg.veil ?? 55 }),
};

document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act && acts[act.dataset.act]) { e.preventDefault(); acts[act.dataset.act](act, e); return; }
  const ty = e.target.closest('[data-type]');
  if (ty) { S.type = ty.dataset.type; updateList(); return; }
  const yr = e.target.closest('[data-year]');
  if (yr) { S.year = yr.dataset.year; S.month = 'all'; updateList(); return; }
  const bgs = e.target.closest('[data-bg]');
  if (bgs) { setBackground({ color: bgs.dataset.bg === 'default' ? null : bgs.dataset.bg, image: null, veil: S.bg.veil ?? 55 }); return; }
  const mo = e.target.closest('[data-month]');
  if (mo) { S.month = mo.dataset.month === 'all' ? 'all' : +mo.dataset.month; updateList(); return; }
  if (!F) return;
  const ft = e.target.closest('[data-ftype]');
  if (ft) { F.type = ft.dataset.ftype; paintTypes(); paintPeopleLabel(); return; }
  const fs = e.target.closest('[data-fstyle]');
  if (fs) { F.style = fs.dataset.fstyle; document.querySelectorAll('[data-fstyle]').forEach((b) => b.classList.toggle('on', b === fs)); return; }
  const rp = e.target.closest('[data-rmphoto]');
  if (rp) { F.photos.splice(+rp.dataset.rmphoto, 1); paintPhotos(); return; }
  const ol = e.target.closest('[data-ocrline]');
  if (ol) {
    const target = F.last && document.body.contains(F.last) ? F.last : document.getElementById('f-title');
    target.value = target.value ? `${target.value} ${ol.dataset.ocrline}` : ol.dataset.ocrline;
    toast('입력했어요');
  }
});
document.addEventListener('focusin', (e) => {
  if (F && e.target.matches('input:not([type=file]):not([type=date]),textarea')) F.last = e.target;
});
// OCR 칩을 눌러도 입력칸 포커스가 유지되도록
document.addEventListener('mousedown', (e) => { if (e.target.closest('[data-ocrline]')) e.preventDefault(); });
window.addEventListener('hashchange', route);

/* ───────── 시작 ───────── */
(async function boot() {
  try {
    await loadAll();
  } catch (err) {
    view.innerHTML = `<div class="empty"><h2>저장소를 열 수 없어요</h2><p>사생활 보호(비공개) 모드이거나 브라우저 설정 때문일 수 있어요.<br>${esc(err.message)}</p></div>`;
    return;
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  route();
})();
