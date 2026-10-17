// [실험 기능] 티켓 이미지의 글자 읽기. 무료 오픈소스 Tesseract.js를 필요할 때만 CDN에서 내려받습니다.
// 인터넷 연결이 필요하고(언어 데이터 수 MB), 티켓 디자인에 따라 정확도 차이가 큽니다.
const SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error('글자 인식 엔진을 내려받지 못했어요. 인터넷 연결을 확인해 주세요.'));
    document.head.appendChild(s);
  });
}

export async function recognize(blob, onProgress) {
  if (!window.Tesseract) await loadScript(SRC);
  const worker = await window.Tesseract.createWorker('kor+eng', 1, {
    logger: (m) => onProgress?.(m),
  });
  try {
    const { data } = await worker.recognize(blob);
    return data.text || '';
  } finally {
    await worker.terminate();
  }
}

export function parseTicketText(text) {
  const clean = text.replace(/[ \t]+/g, ' ');
  let date = null;
  const m = clean.match(/(20\d{2})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
  if (m) {
    const mo = +m[2], d = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      date = `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  const lines = [...new Set(clean.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 2 && /[0-9A-Za-z가-힣]/.test(l)))];
  return { date, lines: lines.slice(0, 30) };
}
