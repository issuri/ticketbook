// 사진 자르기: 갤러리에서 고르거나 촬영한 직후, 또는 등록 화면의 "자르기" 버튼으로 연다.
// 모서리 핸들로 영역을 조절하고, 비율(자유/원본/3:4/1:1/4:3)과 90° 회전을 지원한다. 외부 라이브러리 없음.
// openCropper(blob) → Promise<Blob | null>   (null = 취소)
const MAX_SRC = 3000; // 편집용 원본 캔버스의 긴 변 상한(메모리 보호)
const MAX_OUT = 2400;
const MIN = 48;       // 자르기 영역 최소 크기(px)

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없어요. 다른 사진으로 시도해 주세요.')); };
    img.src = url;
  });
}

// 티켓 테두리 자동 찾기: 가장자리 색(여백·배경)과 다른 부분의 바깥 경계를 찾는다.
// 배경이 균일한 경우(스크린샷 여백, 단색 책상 위 티켓 사진)에 잘 맞고, 배경이 복잡하면 null(= 자동 맞춤 안 함).
// 반환: 원본 캔버스 픽셀 좌표의 {x, y, w, h}
export function detectTicketRect(src) {
  const sc = 240 / Math.max(src.width, src.height);
  const w = Math.max(16, Math.round(src.width * sc)), h = Math.max(16, Math.round(src.height * sc));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const at = (x, y) => (y * w + x) * 4;

  // 1) 가장자리 띠의 대표 색(중앙값)과 흔들림
  const t = Math.max(2, Math.round(Math.min(w, h) * 0.025));
  const ring = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x < t || y < t || x >= w - t || y >= h - t) { const i = at(x, y); ring.push([px[i], px[i + 1], px[i + 2]]); }
  }
  const med = (ch) => { const a = ring.map((p) => p[ch]).sort((p, q) => p - q); return a[a.length >> 1]; };
  const bg = [med(0), med(1), med(2)];
  const dist = (r, g, b) => Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
  const spread = ring.reduce((s, p) => s + dist(p[0], p[1], p[2]), 0) / ring.length;
  if (spread > 38) return null; // 배경이 균일하지 않음

  // 2) 배경과 다른 픽셀이 충분히 있는 첫/마지막 행·열
  const T = 30 + spread * 2;
  const rows = new Array(h).fill(0), cols = new Array(w).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = at(x, y);
    if (dist(px[i], px[i + 1], px[i + 2]) > T) { rows[y]++; cols[x]++; }
  }
  const rMin = Math.max(2, Math.round(w * 0.03)), cMin = Math.max(2, Math.round(h * 0.03));
  let top = rows.findIndex((v) => v >= rMin), left = cols.findIndex((v) => v >= cMin);
  let bottom = h - 1 - [...rows].reverse().findIndex((v) => v >= rMin), right = w - 1 - [...cols].reverse().findIndex((v) => v >= cMin);
  if (top < 0 || left < 0 || bottom <= top || right <= left) return null;

  // 3) 살짝 여유를 두고 원본 좌표로
  const mx = Math.round(w * 0.012), my = Math.round(h * 0.012);
  top = Math.max(0, top - my); left = Math.max(0, left - mx); bottom = Math.min(h - 1, bottom + my); right = Math.min(w - 1, right + mx);
  const area = ((right - left + 1) * (bottom - top + 1)) / (w * h);
  if (area > 0.97 || area < 0.12) return null; // 거의 전체이거나 너무 작으면 그대로 둠
  return { x: left / sc, y: top / sc, w: (right - left + 1) / sc, h: (bottom - top + 1) / sc };
}

export async function openCropper(blob) {
  const img = await loadImage(blob);
  const k = Math.min(1, MAX_SRC / Math.max(img.naturalWidth, img.naturalHeight));
  let src = document.createElement('canvas');
  src.width = Math.round(img.naturalWidth * k); src.height = Math.round(img.naturalHeight * k);
  src.getContext('2d').drawImage(img, 0, 0, src.width, src.height);
  let rotated = false;

  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'cropper';
    root.setAttribute('role', 'dialog');
    root.innerHTML = `
      <div class="cp-bar"><button class="link" data-a="cancel">취소</button><b class="ftitle">사진 자르기</b><button class="link strong" data-a="done">완료</button></div>
      <div class="cp-stage"><canvas class="cp-img"></canvas>
        <div class="cp-box"><span class="cp-grid"></span>
          <i class="cp-h" data-h="tl"></i><i class="cp-h" data-h="tr"></i><i class="cp-h" data-h="bl"></i><i class="cp-h" data-h="br"></i></div></div>
      <div class="cp-tools">
        <div class="chips" id="cp-ratios">
          <button class="chip on" data-r="free">자유</button><button class="chip" data-r="orig">원본 비율</button>
          <button class="chip" data-r="0.75">3:4</button><button class="chip" data-r="1">1:1</button><button class="chip" data-r="1.3333">4:3</button>
        </div>
        <div class="row center"><button class="btn ghost small" data-a="auto">✨ 테두리에 맞추기</button><button class="btn ghost small" data-a="full">전체</button><button class="btn ghost small" data-a="rotate">↻ 회전</button><button class="btn ghost small" data-a="orig">자르지 않고 쓰기</button></div>
        <p class="thint" id="cp-hint">모서리를 끌어 영역을 줄이고, 안쪽을 끌어 옮겨요</p>
      </div>`;
    document.body.appendChild(root);
    document.body.classList.add('cropping');

    const stage = root.querySelector('.cp-stage');
    const cv = root.querySelector('.cp-img');
    const box = root.querySelector('.cp-box');
    let ratio = null;          // null=자유, 숫자=가로/세로
    let ox = 0, oy = 0, dw = 0, dh = 0; // 화면에 보이는 이미지 영역(스테이지 기준 px)
    let R = { x: 0, y: 0, w: 0, h: 0 }; // 자르기 영역(스테이지 기준 px)
    let auto = null;                    // 자동으로 찾은 티켓 테두리(원본 캔버스 좌표)

    const draw = () => { box.style.left = `${R.x}px`; box.style.top = `${R.y}px`; box.style.width = `${R.w}px`; box.style.height = `${R.h}px`; };
    const fitRatio = (r) => {  // 현재 영역 중심을 유지하며 비율에 맞게 줄임
      let w = R.w, h = R.h;
      if (w / h > r) w = h * r; else h = w / r;
      const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
      R = { x: cx - w / 2, y: cy - h / 2, w, h };
    };
    const layout = (reset) => {
      const sw = stage.clientWidth, sh = stage.clientHeight;
      const s = Math.min(sw / src.width, sh / src.height);
      dw = src.width * s; dh = src.height * s; ox = (sw - dw) / 2; oy = (sh - dh) / 2;
      cv.width = src.width; cv.height = src.height;
      cv.getContext('2d').drawImage(src, 0, 0);
      Object.assign(cv.style, { left: `${ox}px`, top: `${oy}px`, width: `${dw}px`, height: `${dh}px` });
      if (reset) {
        auto = detectTicketRect(src);
        applyAuto(true);
      } else draw();
    };
    // 자동으로 찾은 티켓 테두리를 자르기 영역으로 (못 찾으면 전체)
    const applyAuto = (initial) => {
      const hint = root.querySelector('#cp-hint');
      const s = dw / src.width;
      if (auto) {
        R = { x: ox + auto.x * s, y: oy + auto.y * s, w: auto.w * s, h: auto.h * s };
        ratio = null; root.querySelectorAll('#cp-ratios .chip').forEach((c) => c.classList.toggle('on', c.dataset.r === 'free'));
        hint.textContent = '티켓 테두리에 맞춰 두었어요. 모서리를 끌어 다듬을 수 있어요';
      } else {
        R = { x: ox, y: oy, w: dw, h: dh };
        if (ratio) fitRatio(ratio);
        hint.textContent = initial ? '모서리를 끌어 영역을 줄이고, 안쪽을 끌어 옮겨요' : '테두리를 찾지 못했어요. 직접 맞춰 주세요';
      }
      draw();
    };
    requestAnimationFrame(() => layout(true));

    /* 비율 선택 */
    root.querySelector('#cp-ratios').onclick = (e) => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      root.querySelectorAll('#cp-ratios .chip').forEach((c) => c.classList.toggle('on', c === b));
      const v = b.dataset.r;
      ratio = v === 'free' ? null : v === 'orig' ? src.width / src.height : +v;
      if (ratio) fitRatio(ratio);
      draw();
    };

    /* 끌기: 이동 / 모서리 크기조절 */
    let drag = null;
    const clampRect = () => { R.x = Math.min(Math.max(R.x, ox), ox + dw - R.w); R.y = Math.min(Math.max(R.y, oy), oy + dh - R.h); };
    const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    box.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('[data-h]');
      const p = local(e);
      if (h) {
        const id = h.dataset.h;
        const ax = id.includes('l') ? R.x + R.w : R.x;   // 반대편 모서리가 고정점
        const ay = id.includes('t') ? R.y + R.h : R.y;
        drag = { mode: 'size', ax, ay };
      } else {
        drag = { mode: 'move', px: p.x, py: p.y, x0: R.x, y0: R.y };
      }
      box.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = local(e);
      if (drag.mode === 'move') {
        R.x = drag.x0 + (p.x - drag.px); R.y = drag.y0 + (p.y - drag.py); clampRect();
      } else {
        const px = Math.min(Math.max(p.x, ox), ox + dw), py = Math.min(Math.max(p.y, oy), oy + dh);
        const sx = px < drag.ax ? -1 : 1, sy = py < drag.ay ? -1 : 1;
        let w = Math.abs(px - drag.ax), h = Math.abs(py - drag.ay);
        if (ratio) {
          if (w / Math.max(h, 1) > ratio) w = h * ratio; else h = w / ratio;
          const maxW = sx > 0 ? ox + dw - drag.ax : drag.ax - ox, maxH = sy > 0 ? oy + dh - drag.ay : drag.ay - oy;
          if (w > maxW) { w = maxW; h = w / ratio; }
          if (h > maxH) { h = maxH; w = h * ratio; }
        }
        w = Math.max(w, MIN); h = Math.max(h, ratio ? MIN / ratio : MIN);
        R = { x: sx > 0 ? drag.ax : drag.ax - w, y: sy > 0 ? drag.ay : drag.ay - h, w, h };
        clampRect();
      }
      draw();
    });
    const end = () => { drag = null; };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);

    /* 결과 만들기 */
    const exportBlob = (full) => {
      const s = src.width / dw;
      const sx = full ? 0 : (R.x - ox) * s, sy = full ? 0 : (R.y - oy) * s;
      const sw = full ? src.width : R.w * s, sh = full ? src.height : R.h * s;
      const k2 = Math.min(1, MAX_OUT / Math.max(sw, sh));
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(sw * k2)); out.height = Math.max(1, Math.round(sh * k2));
      out.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
      return new Promise((res) => out.toBlob((b) => res(b), 'image/jpeg', 0.92));
    };
    const close = (v) => { root.remove(); document.body.classList.remove('cropping'); window.removeEventListener('resize', onResize); resolve(v); };
    const onResize = () => layout(true);
    window.addEventListener('resize', onResize);

    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'cancel') close(null);
      else if (a === 'done') close(await exportBlob(false));
      else if (a === 'orig') close(rotated ? await exportBlob(true) : blob);
      else if (a === 'auto') applyAuto(false);
      else if (a === 'full') {
        R = { x: ox, y: oy, w: dw, h: dh }; if (ratio) fitRatio(ratio); draw();
        root.querySelector('#cp-hint').textContent = '전체 사진을 선택했어요';
      }
      else if (a === 'rotate') {
        const r = document.createElement('canvas');
        r.width = src.height; r.height = src.width;
        const g = r.getContext('2d');
        g.translate(r.width, 0); g.rotate(Math.PI / 2); g.drawImage(src, 0, 0);
        src = r; rotated = !rotated;
        // 한 번 더 돌리면 원래대로일 수 있지만 단순하게 "회전함"으로 취급
        rotated = true;
        if (ratio && root.querySelector('#cp-ratios .chip.on')?.dataset.r === 'orig') ratio = src.width / src.height;
        layout(true);
      }
    });
  });
}
