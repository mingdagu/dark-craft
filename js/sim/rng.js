// 确定性随机源（mulberry32）与空间散列噪声 —— 模拟核心专用，禁止在此文件外创建游戏逻辑随机数
export function makeRng(seed) {
  let s = seed >>> 0;
  const fn = function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.getState = () => s >>> 0;
  fn.setState = v => { s = v >>> 0; };
  return fn;
}

export function hash2(x, z, seed) {
  let n = (x * 374761393 + z * 668265263 + (seed | 0) * 144665) | 0;
  n = ((n ^ (n >>> 13)) * 1274126177) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function smoothNoise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, z, seed) {
  return smoothNoise(x, z, seed) * 0.55
    + smoothNoise(x * 2.1, z * 2.1, seed + 7) * 0.3
    + smoothNoise(x * 4.3, z * 4.3, seed + 19) * 0.15;
}
