// 라이브러리 없는 최소 ZIP 구현 (무압축 'store' 방식).
// 이미지는 이미 JPEG라 압축 이득이 거의 없고, 대신 메모리를 적게 쓰며 어떤 압축 프로그램으로도 열립니다.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

// files: [{name, blob}] -> Blob(zip). 파일을 하나씩 읽어 CRC만 계산하고 Blob 자체는 그대로 이어 붙입니다.
export async function makeZip(files, onProgress) {
  const parts = [];
  const central = [];
  let offset = 0;
  let done = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const size = f.blob.size;
    const crc = crc32(new Uint8Array(await f.blob.arrayBuffer()));
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 이름
    lh.setUint16(8, 0, true);      // store
    lh.setUint16(10, 0, true);
    lh.setUint16(12, 0x21, true);  // 1980-01-01
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, f.blob);
    central.push({ name, size, crc, offset });
    offset += 30 + name.length + size;
    onProgress?.(++done, files.length);
  }
  const cdStart = offset;
  for (const e of central) {
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true);
    ch.setUint16(14, 0x21, true);
    ch.setUint32(16, e.crc, true);
    ch.setUint32(20, e.size, true);
    ch.setUint32(24, e.size, true);
    ch.setUint16(28, e.name.length, true);
    ch.setUint32(42, e.offset, true);
    parts.push(ch.buffer, e.name);
    offset += 46 + e.name.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, central.length, true);
  end.setUint16(10, central.length, true);
  end.setUint32(12, offset - cdStart, true);
  end.setUint32(16, cdStart, true);
  parts.push(end.buffer);
  return new Blob(parts, { type: 'application/zip' });
}

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', json: 'application/json' };

// 이 앱이 만든(무압축) ZIP을 읽습니다. 파일 전체를 메모리에 올리지 않고 Blob.slice로 필요한 부분만 읽습니다.
export async function readZip(file) {
  const tailLen = Math.min(file.size, 22 + 65535);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('올바른 ZIP 파일이 아니에요.');
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOff = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 구조가 손상되었어요.');
    const method = cd.getUint16(p + 10, true);
    const csize = cd.getUint32(p + 20, true);
    const nlen = cd.getUint16(p + 28, true);
    const elen = cd.getUint16(p + 30, true);
    const clen = cd.getUint16(p + 32, true);
    const lho = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nlen));
    entries.set(name, { method, csize, lho });
    p += 46 + nlen + elen + clen;
  }
  return {
    has: (name) => entries.has(name),
    names: () => [...entries.keys()],
    async blob(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (e.method !== 0) throw new Error('이 앱에서 만든 백업 파일만 복원할 수 있어요.');
      const lh = new DataView(await file.slice(e.lho, e.lho + 30).arrayBuffer());
      const start = e.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const ext = name.split('.').pop().toLowerCase();
      return file.slice(start, start + e.csize, MIME[ext] || 'application/octet-stream');
    },
  };
}
