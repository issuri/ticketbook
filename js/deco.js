// 티켓 꾸미기: 프레임 + 테이프 + 스티커 + 도장·별점.
// 꾸밈은 원본 이미지 위에 겹쳐 놓는 "레이어"이고, 위치·크기는 이미지 크기에 대한 % 로만 저장한다.
// (원본 이미지는 절대 수정하지 않음 / 홈 카드·상세·PNG 내보내기가 같은 데이터를 쓴다)
// deco = { frame: 'none'|'polaroid'|'film'|'stamp'|'round', items: [{ id, k, v, x, y, s, r }] }
//   k: emoji | shape | tape | stamp | stars,  x/y: 중심 위치(%),  s: 크기 배율,  r: 회전(도)
import { uid } from './db.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const FRAMES = [['none', '없음'], ['polaroid', '폴라로이드'], ['film', '필름'], ['stamp', '우표'], ['round', '둥근']];
export const EMOJIS = ['❤️', '💜', '✨', '🌟', '🎉', '🎶', '🎤', '🎬', '🍿', '⚽', '⚾', '🏆', '🎫', '🌈', '🌸', '🍀', '🔥', '😭', '🥹', '😍', '🤩', '👏', '💌', '📸'];

const SVG = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${inner}</svg>`;
const burstPts = Array.from({ length: 24 }, (_, i) => {
  const a = (Math.PI * 2 * i) / 24 - Math.PI / 2, r = i % 2 ? 8.2 : 11;
  return `${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`;
}).join(' ');
export const SHAPES = {
  star: SVG('<path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.5 6 20.9l1.3-6.7-5-4.7 6.8-.8z" fill="#ffd66b" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>'),
  heart: SVG('<path d="M12 21s-7.5-4.6-9.5-9.2C1 8 3.2 4.5 6.7 4.5c2 0 3.6 1 5.3 3 1.7-2 3.3-3 5.3-3 3.5 0 5.7 3.5 4.2 7.3C19.5 16.4 12 21 12 21z" fill="#ff7aa2" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>'),
  sparkle: SVG('<path d="M12 1c.8 6 3.2 9.2 11 11-7.8 1.8-10.2 5-11 11-.8-6-3.2-9.2-11-11 7.8-1.8 10.2-5 11-11z" fill="#bfaeff" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>'),
  burst: SVG(`<polygon points="${burstPts}" fill="#ff9f86" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>`),
  flower: SVG('<g fill="#ffb3d1" stroke="#fff" stroke-width="1"><circle cx="12" cy="5.8" r="4.4"/><circle cx="18" cy="10.2" r="4.4"/><circle cx="15.7" cy="17.3" r="4.4"/><circle cx="8.3" cy="17.3" r="4.4"/><circle cx="6" cy="10.2" r="4.4"/></g><circle cx="12" cy="12" r="3.4" fill="#ffd66b"/>'),
  dot: SVG('<circle cx="12" cy="12" r="10" fill="#8cc8ff" stroke="#fff" stroke-width="2"/>'),
};
export const TAPES = {
  tint: { c: 'var(--tint,#bfaeff)', p: 'stripe' }, // 기본 테이프: 티켓 종류색
  y: { c: '#ffe69a', p: 'stripe' }, p: { c: '#ffc2dc', p: 'dots' }, m: { c: '#b5ecd0', p: 'none' },
  s: { c: '#b9dcff', p: 'grid' }, l: { c: '#d4c8ff', p: 'stripe' }, k: { c: '#e8d5b0', p: 'none' },
};
export const STAMPS = {
  done: { t: '관람 완료', c: '#e0364f' }, again: { t: '또 보고 싶다', c: '#3b5bdb' }, best: { t: '인생 공연', c: '#d9480f' },
  cry: { t: '울었다', c: '#7048e8' }, win: { t: '직관 승리', c: '#2f9e44' }, been: { t: '다녀왔어요', c: '#e8590c' },
};

function tapeBg(v) {
  const t = TAPES[v] || TAPES.y;
  const pat = t.p === 'stripe' ? 'repeating-linear-gradient(135deg,rgba(255,255,255,.55) 0 1.4cqw,transparent 1.4cqw 2.8cqw)'
    : t.p === 'dots' ? 'radial-gradient(circle,rgba(255,255,255,.8) .55cqw,transparent .65cqw)'
    : t.p === 'grid' ? 'linear-gradient(rgba(255,255,255,.65) .25cqw,transparent .25cqw),linear-gradient(90deg,rgba(255,255,255,.65) .25cqw,transparent .25cqw)' : 'none';
  return `background-color:${t.c};background-image:${pat};background-size:2.4cqw 2.4cqw;`;
}

function itemHtml(it, edit, sel) {
  let inner = '', extra = '';
  if (it.k === 'emoji') inner = esc(it.v);
  else if (it.k === 'shape') inner = SHAPES[it.v] || '';
  else if (it.k === 'tape') extra = tapeBg(it.v);
  else if (it.k === 'stamp') { const s = STAMPS[it.v] || STAMPS.done; inner = esc(s.t); extra = `color:${s.c};`; }
  else if (it.k === 'stars') { const n = Math.min(5, Math.max(1, +it.v || 5)); inner = `${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span>`; }
  const handles = edit && sel ? '<i class="hd hd-del" data-hd="del">✕</i><i class="hd hd-tf" data-hd="tf">↻</i>' : '';
  return `<span class="di k-${it.k}${sel ? ' sel' : ''}" data-i="${it.id}" style="left:${it.x}%;top:${it.y}%;--s:${it.s};--r:${it.r}deg;${extra}">${inner}${handles}</span>`;
}

// base: 기본 테이프(티켓마다 위치가 정해진 종류색 테이프). 다른 스티커와 똑같이 선택·이동·크기조절·삭제가 된다.
export function decoLayerHtml(d, edit = false, sel = null, base = null) {
  const frame = d?.frame && d.frame !== 'none' ? '<span class="dfr"></span>' : '';
  return frame + (base ? itemHtml(base, edit, sel === 'base') : '') + (d?.items || []).map((it) => itemHtml(it, edit, it.id === sel)).join('');
}
export const layerFor = (t) => decoLayerHtml(t.deco, false, null, baseTapeOf(t));

export const rotOf = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997; return ((h % 31) - 15) / 10; };
// deco.tape: undefined=기본 위치 그대로, false=삭제함, {x,y,s,r}=사용자가 옮기거나 키운 값
export function baseTapeOf(t) {
  const d = t.deco;
  if (d?.tape === false || d?.noTape) return null;
  const o = d?.tape || {}, rot = rotOf(t.id);
  return { id: 'base', k: 'tape', v: 'tint', x: o.x ?? clamp(50 + rot * 22, 18, 82), y: o.y ?? -2, s: o.s ?? 1, r: o.r ?? +(rot * -4 + 3).toFixed(1) };
}

/* ───────── 편집기 ───────── */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);

// view 안의 #dtk(이미지 상자)를 편집 상태로 바꾼다. 끝나면 onDone(결과) — 취소는 false, 꾸밈 없음은 null.
export function startEditor({ view, ticket, confirmFn, onDone }) {
  const dtk = view.querySelector('#dtk');
  const layer = dtk.querySelector('.dlayer');
  const bar = view.querySelector('.dbar');
  const D = JSON.parse(JSON.stringify(ticket.deco || { frame: 'none', items: [] }));
  D.items = D.items || [];
  let B = baseTapeOf({ id: ticket.id, deco: ticket.deco }); // 기본 테이프 (null이면 삭제됨)
  let bt = !!(ticket.deco && ticket.deco.tape && typeof ticket.deco.tape === 'object'); // 기본 테이프를 옮기거나 키웠는지
  const hist = [];
  let sel = null, dirty = false, tab = 'frame', drag = null;

  const state = () => JSON.stringify({ frame: D.frame, items: D.items, B, bt });
  const paint = () => {
    dtk.className = `dtk edit f-${D.frame || 'none'}`;
    layer.innerHTML = decoLayerHtml(D, true, sel, B);
  };
  const elOf = (id) => layer.querySelector(`[data-i="${id}"]`);
  const itemById = (id) => (id === 'base' ? B : D.items.find((i) => i.id === id));
  const cur = () => itemById(sel);
  const restore = (json) => { const o = JSON.parse(json); D.frame = o.frame; D.items = o.items; B = o.B; bt = o.bt; };
  const snap = () => { hist.push(state()); if (hist.length > 40) hist.shift(); dirty = true; };

  /* 위쪽 바 */
  const barHtml = bar.innerHTML;
  bar.innerHTML = '<button class="link" data-d="cancel">취소</button><b class="ftitle">꾸미기</b><span><button class="link" data-d="undo">되돌리기</button><button class="link strong" data-d="done">완료</button></span>';
  bar.onclick = async (e) => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    if (b.dataset.d === 'undo') { const h = hist.pop(); if (h) { restore(h); sel = null; paint(); } }
    else if (b.dataset.d === 'cancel') {
      if (dirty && !await confirmFn('꾸미기를 그만둘까요?', '지금까지 꾸민 내용은 저장되지 않아요.', '그만두기')) return;
      bar.innerHTML = barHtml; tray.remove(); onDone(false);
    } else if (b.dataset.d === 'done') {
      const tape = B === null ? false : bt ? { x: B.x, y: B.y, s: B.s, r: B.r } : undefined;
      const out = D.items.length || tape !== undefined || (D.frame && D.frame !== 'none')
        ? { frame: D.frame || 'none', items: D.items, ...(tape !== undefined ? { tape } : {}) } : null;
      tray.remove(); onDone(out);
    }
  };

  /* 아래 트레이 */
  const tray = document.createElement('div');
  tray.className = 'dtray';
  const tabs = [['frame', '프레임'], ['tape', '테이프'], ['sticker', '스티커'], ['stamp', '도장 · 별점']];
  const drawTray = () => {
    let panel = '';
    if (tab === 'frame') panel = FRAMES.map(([k, n]) => `<button class="opt ${D.frame === k ? 'on' : ''}" data-frame="${k}">${n}</button>`).join('');
    else if (tab === 'tape') panel = Object.keys(TAPES).map((k) => `<button class="opt tapeopt" data-add="tape:${k}" aria-label="테이프" style="${tapeBg(k)}"></button>`).join('');
    else if (tab === 'sticker') panel = Object.keys(SHAPES).map((k) => `<button class="opt shp" data-add="shape:${k}" aria-label="${k}">${SHAPES[k]}</button>`).join('')
      + EMOJIS.map((e) => `<button class="opt emo" data-add="emoji:${e}">${e}</button>`).join('');
    else panel = Object.entries(STAMPS).map(([k, s]) => `<button class="opt stp" data-add="stamp:${k}" style="color:${s.c}">${s.t}</button>`).join('')
      + [1, 2, 3, 4, 5].map((n) => `<button class="opt str" data-add="stars:${n}">${'★'.repeat(n)}</button>`).join('');
    tray.innerHTML = `<div class="ttabs">${tabs.map(([k, n]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
      <div class="topts">${panel}</div>
      <div class="tfoot"><p class="thint">${sel ? '모서리 ↻ 를 끌면 크기·회전, ✕ 는 삭제' : '붙인 것을 눌러 선택하고, 끌어서 옮겨요'}</p><button class="clearall" data-clear>모두 지우기</button></div>`;
  };
  tray.onclick = async (e) => {
    const t = e.target.closest('[data-tab]'), f = e.target.closest('[data-frame]'), a = e.target.closest('[data-add]');
    if (e.target.closest('[data-clear]')) {
      if (!D.items.length && (!D.frame || D.frame === 'none') && B === null) return;
      if (!await confirmFn('꾸민 것을 모두 지울까요?', '붙인 스티커·테이프(기본 테이프 포함)·도장과 프레임이 모두 사라져요. "되돌리기"로 다시 살릴 수 있어요.', '모두 지우기')) return;
      snap(); D.items = []; D.frame = 'none'; B = null; bt = false; sel = null; paint(); drawTray(); return;
    }
    if (t) { tab = t.dataset.tab; drawTray(); }
    else if (f) { snap(); D.frame = f.dataset.frame; paint(); drawTray(); }
    else if (a) {
      const [k, ...rest] = a.dataset.add.split(':');
      snap();
      const it = { id: uid(), k, v: rest.join(':'), x: clamp(50 + rnd(-10, 10), 8, 92), y: clamp(50 + rnd(-10, 10), 8, 92), s: 1, r: k === 'tape' ? rnd(-16, 16) : rnd(-8, 8) };
      D.items.push(it); sel = it.id; paint(); drawTray();
    }
  };
  view.appendChild(tray);
  view.classList.add('decoing');
  paint(); drawTray();

  /* 스테이지: 끌어서 이동, 모서리 핸들로 크기·회전 */
  dtk.addEventListener('pointerdown', (e) => {
    const hd = e.target.closest('[data-hd]'), el = e.target.closest('.di');
    const rect = dtk.getBoundingClientRect();
    if (hd && sel) {
      if (hd.dataset.hd === 'del') {
        snap();
        if (sel === 'base') { B = null; bt = false; } else D.items = D.items.filter((i) => i.id !== sel);
        sel = null; paint(); drawTray(); return;
      }
      const it = cur(), r = elOf(sel).getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      drag = { mode: 'tf', it, cx, cy, d0: Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy)), a0: Math.atan2(e.clientY - cy, e.clientX - cx), s0: it.s, r0: it.r, before: state(), snapped: false, sx: e.clientX, sy: e.clientY };
    } else if (el) {
      const it = itemById(el.dataset.i);
      if (!it) return;
      if (it !== B) D.items = D.items.filter((i) => i !== it).concat(it); // 맨 위로
      const was = sel; sel = it.id;
      if (was !== sel) { paint(); drawTray(); }
      drag = { mode: 'mv', it, rect, x0: e.clientX, y0: e.clientY, ox: it.x, oy: it.y, before: state(), snapped: false, sx: e.clientX, sy: e.clientY };
    } else {
      if (sel) { sel = null; paint(); drawTray(); }
      return;
    }
    dtk.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  dtk.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.snapped) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
      hist.push(drag.before); if (hist.length > 40) hist.shift(); dirty = true; drag.snapped = true;
    }
    const el = elOf(drag.it.id); if (!el) return;
    const it = drag.it;
    if (it === B) bt = true;
    if (drag.mode === 'mv') {
      it.x = +clamp(drag.ox + ((e.clientX - drag.x0) / drag.rect.width) * 100, 0, 100).toFixed(2);
      it.y = +clamp(drag.oy + ((e.clientY - drag.y0) / drag.rect.height) * 100, 0, 100).toFixed(2);
      el.style.left = `${it.x}%`; el.style.top = `${it.y}%`;
    } else {
      const d = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy), a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
      it.s = +clamp(drag.s0 * (d / drag.d0), 0.3, 4).toFixed(3);
      it.r = +(drag.r0 + ((a - drag.a0) * 180) / Math.PI).toFixed(1);
      el.style.setProperty('--s', it.s); el.style.setProperty('--r', `${it.r}deg`);
    }
  });
  const end = () => { drag = null; };
  dtk.addEventListener('pointerup', end);
  dtk.addEventListener('pointercancel', end);
}

/* ───────── PNG 내보내기 (캔버스에 같은 규칙으로 다시 그림) ───────── */
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('이미지를 불러오지 못했어요.')); i.src = src; });
const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };

const FRAME_INSETS = { polaroid: [4, 4, 4, 14], film: [7, 3, 7, 3], stamp: [5, 5, 5, 5], round: [3, 3, 3, 3] }; // [왼, 위, 오른, 아래] (가로폭 %)
const FRAME_BG = { polaroid: '#fff', film: '#17151a', stamp: '#fff', round: '#fff' };

// 이미지가 없는 티켓의 바탕(제목·날짜가 적힌 3:4 카드)을 캔버스로 그린다
function drawPlaceholder(ph) {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 1200;
  const g = c.getContext('2d');
  g.fillStyle = ph.bg || '#e3ddf7'; g.fillRect(0, 0, 900, 1200);
  g.setLineDash([18, 12]); g.strokeStyle = 'rgba(128,118,190,.55)'; g.lineWidth = 5; g.strokeRect(40, 40, 820, 1120); g.setLineDash([]);
  g.fillStyle = '#271f55'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '170px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.fillText(ph.emoji || '🎫', 450, 400);
  g.font = '700 64px "Gowun Dodum","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  const words = Array.from(ph.title || '제목 없음'); const lines = []; let cur = '';
  for (const ch of words) { if (g.measureText(cur + ch).width > 720) { lines.push(cur); cur = ch; } else cur += ch; }
  lines.push(cur);
  lines.slice(0, 4).forEach((l, i) => g.fillText(l, 450, 620 + i * 84));
  g.font = '44px "Gowun Dodum","Apple SD Gothic Neo","Malgun Gothic",sans-serif'; g.globalAlpha = 0.65;
  g.fillText(ph.date || '', 450, 620 + Math.min(lines.length, 4) * 84 + 30);
  return c;
}

// imageBlob 이 null 이면(이미지 없는 티켓) ph={emoji,title,date,bg} 로 바탕을 만든다
export async function renderDecoPng(imageBlob, deco, ph) {
  let img;
  if (imageBlob) {
    const url = URL.createObjectURL(imageBlob);
    try { img = await loadImg(url); } finally { URL.revokeObjectURL(url); }
  } else {
    img = drawPlaceholder(ph || {});
  }
  const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
  const k = Math.min(1, 2000 / Math.max(nw, nh));
  const W = Math.round(nw * k), H = Math.round(nh * k), u = W / 100;
  const base = baseTapeOf({ id: ph?.id || 'x', deco });
  const items = [...(base ? [base] : []), ...(deco?.items || [])];
  const frame = deco?.frame || 'none';
  const pad = Math.round((deco?.items?.length || deco?.tape ? 10 : 6) * u);
  const canvas = document.createElement('canvas');
  canvas.width = W + pad * 2; canvas.height = H + pad * 2;
  const ctx = canvas.getContext('2d');
  ctx.translate(pad, pad);

  // 프레임은 이미지 "바깥"에 두고 이미지를 안쪽에 맞춰 넣는다 → 티켓 글씨가 프레임에 가려지지 않음
  const fi = FRAME_INSETS[frame];
  if (!fi) {
    ctx.drawImage(img, 0, 0, W, H);
  } else {
    const [l, t, r, b] = fi.map((v) => v * u);
    if (frame === 'round') { ctx.save(); rr(ctx, 0, 0, W, H, 8 * u); ctx.clip(); }
    ctx.fillStyle = FRAME_BG[frame]; ctx.fillRect(0, 0, W, H);
    const iw = W - l - r, ih = H - t - b, sc = Math.min(iw / nw, ih / nh);
    const dw = nw * sc, dh = nh * sc, dx = l + (iw - dw) / 2, dy = t + (ih - dh) / 2;
    if (frame === 'round') { ctx.save(); rr(ctx, dx, dy, dw, dh, 5 * u); ctx.clip(); ctx.drawImage(img, dx, dy, dw, dh); ctx.restore(); }
    else ctx.drawImage(img, dx, dy, dw, dh);
    if (frame === 'film') {
      ctx.fillStyle = '#f4efe4';
      for (let y = 2 * u; y < H - 4 * u; y += 5 * u) { rr(ctx, 2 * u, y, 3 * u, 2.6 * u, 0.6 * u); ctx.fill(); rr(ctx, W - 5 * u, y, 3 * u, 2.6 * u, 0.6 * u); ctx.fill(); }
    } else if (frame === 'stamp') {
      ctx.setLineDash([1.6 * u, 1.2 * u]); ctx.strokeStyle = '#cdbfe0'; ctx.lineWidth = 0.5 * u;
      ctx.strokeRect(2.5 * u, 2.5 * u, W - 5 * u, H - 5 * u); ctx.setLineDash([]);
    }
    if (frame === 'round') ctx.restore();
  }

  // 모양 스티커는 SVG를 이미지로 미리 읽어 둔다
  const shapeImgs = {};
  await Promise.all([...new Set(items.filter((i) => i.k === 'shape').map((i) => i.v))].map(async (v) => {
    if (SHAPES[v]) shapeImgs[v] = await loadImg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(SHAPES[v])}`);
  }));
  try { await document.fonts.load('40px "Black Han Sans"'); } catch { /* 글꼴이 없으면 기본 글꼴 */ }

  for (const it of items) {
    const s = it.s || 1;
    ctx.save();
    ctx.translate((it.x / 100) * W, (it.y / 100) * H);
    ctx.rotate(((it.r || 0) * Math.PI) / 180);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (it.k === 'emoji') {
      ctx.font = `${16 * s * u}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.fillText(it.v, 0, 0);
    } else if (it.k === 'shape' && shapeImgs[it.v]) {
      const z = 16 * s * u;
      ctx.shadowColor = 'rgba(0,0,0,.2)'; ctx.shadowBlur = 0.6 * u; ctx.shadowOffsetY = 0.4 * u;
      ctx.drawImage(shapeImgs[it.v], -z / 2, -z / 2, z, z);
    } else if (it.k === 'tape') {
      const t = it.v === 'tint' ? { c: ph?.tint || '#bfaeff', p: 'stripe' } : TAPES[it.v] || TAPES.y, w = 30 * s * u, h = 9 * s * u;
      ctx.globalAlpha = 0.92;
      ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = u; ctx.shadowOffsetY = 0.4 * u;
      ctx.fillStyle = t.c; ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.shadowColor = 'transparent';
      ctx.save(); ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.fillStyle = 'rgba(255,255,255,.8)';
      if (t.p === 'stripe') { ctx.lineWidth = 1.4 * u; for (let x = -w - h; x < w + h; x += 2.8 * u) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + h, -h); ctx.stroke(); } }
      else if (t.p === 'dots') { for (let x = -w / 2 + 1.2 * u; x < w / 2; x += 2.4 * u) for (let y = -h / 2 + 1.2 * u; y < h / 2; y += 2.4 * u) { ctx.beginPath(); ctx.arc(x, y, 0.6 * u, 0, 7); ctx.fill(); } }
      else if (t.p === 'grid') { ctx.lineWidth = 0.25 * u; for (let x = -w / 2; x < w / 2; x += 2.4 * u) { ctx.beginPath(); ctx.moveTo(x, -h / 2); ctx.lineTo(x, h / 2); ctx.stroke(); } for (let y = -h / 2; y < h / 2; y += 2.4 * u) { ctx.beginPath(); ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y); ctx.stroke(); } }
      ctx.restore();
    } else if (it.k === 'stamp') {
      const st = STAMPS[it.v] || STAMPS.done, fs = 5 * s * u;
      ctx.font = `${fs}px "Black Han Sans","Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
      const tw = ctx.measureText(st.t).width, w = tw + 4.8 * s * u + 1.2 * s * u, h = fs * 1.2 + 3.2 * s * u + 1.2 * s * u;
      ctx.globalAlpha = 0.88; ctx.strokeStyle = st.c; ctx.fillStyle = st.c;
      ctx.lineWidth = 0.6 * s * u; rr(ctx, -w / 2 + 0.3 * s * u, -h / 2 + 0.3 * s * u, w - 0.6 * s * u, h - 0.6 * s * u, 0.8 * s * u); ctx.stroke();
      ctx.lineWidth = 0.35 * s * u; rr(ctx, -w / 2 - 0.5 * s * u, -h / 2 - 0.5 * s * u, w + 1 * s * u, h + 1 * s * u, 1.2 * s * u); ctx.stroke();
      ctx.fillText(st.t, 0, fs * 0.04);
    } else if (it.k === 'stars') {
      const n = Math.min(5, Math.max(1, +it.v || 5)), fs = 7 * s * u;
      ctx.font = `${fs}px sans-serif`; ctx.textAlign = 'left';
      const cw = ctx.measureText('★').width;
      ctx.shadowColor = 'rgba(0,0,0,.2)'; ctx.shadowBlur = 0.6 * u; ctx.shadowOffsetY = 0.3 * u;
      for (let i = 0; i < 5; i++) { ctx.fillStyle = i < n ? '#ffb400' : 'rgba(120,110,130,.35)'; ctx.fillText('★', -cw * 2.5 + cw * i, 0); }
    }
    ctx.restore();
  }
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('이미지 변환 실패'))), 'image/png'));
}
