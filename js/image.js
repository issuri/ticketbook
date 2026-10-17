// 이미지 처리: 긴 변 2200px, JPEG 90%로 저장(스크린샷 티켓 글씨가 선명하게 유지되는 수준)하고
// 목록용 작은 썸네일을 따로 만듭니다.
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없어요. 다른 사진으로 시도해 주세요.')); };
    img.src = url;
  });
}

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지 변환 실패'))), 'image/jpeg', quality));
}

async function resize(img, max, quality) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const scale = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // 투명 PNG 대비
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return toBlob(canvas, quality);
}

export async function processImage(file) {
  const img = await loadImage(file);
  const [full, thumb] = await Promise.all([resize(img, 2200, 0.9), resize(img, 640, 0.8)]);
  return { full, thumb };
}

export async function makeThumb(blob) {
  return resize(await loadImage(blob), 640, 0.8);
}
