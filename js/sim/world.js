// 世界生成：256×256 地形（山/平原/河流）、预生成道路与贸易站、资源节点、野生动物初始分布
// 纯函数式生成：同一 seed 必然产出同一世界。本模块不依赖 DOM / Three.js。
import { makeRng, fbm, hash2 } from './rng.js';

export const SIZE = 256;
export const IRRIGATION_RADIUS = 6;

const idx = (x, z) => z * SIZE + x;
const inMap = (x, z) => x >= 0 && x < SIZE && z >= 0 && z < SIZE;

export function generateWorld(seed) {
  const rng = makeRng(seed ^ 0x9E3779B9);
  const height = new Int8Array(SIZE * SIZE);
  const water = new Uint8Array(SIZE * SIZE);
  const road = new Uint8Array(SIZE * SIZE);
  const biome = new Uint8Array(SIZE * SIZE);     // 0平原 1森林 2山地 3腐化
  const irrigated = new Uint8Array(SIZE * SIZE);

  // 1. 高度场：边缘压低，中部起伏，少数山脉
  for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    let n = fbm(x * 0.018, z * 0.018, seed);
    const ridge = fbm(x * 0.011 + 40, z * 0.011 + 40, seed + 101);
    if (ridge > 0.62) n += (ridge - 0.62) * 3.2;            // 山脉抬升
    const edge = Math.min(x, z, SIZE - 1 - x, SIZE - 1 - z) / 28;
    n *= Math.min(1, edge * 0.55 + 0.45);                    // 边缘缓降
    let h = Math.floor(n * 13) - 1;
    if (h < 0) h = 0; if (h > 14) h = 14;
    height[idx(x, z)] = h;
  }

  // 2. 河流：从两处高地用"水滴法"下坡流到地图边缘
  carveRiver(height, water, rng, seed, 0.3);
  carveRiver(height, water, rng, seed, 0.7);

  // 3. 灌溉范围：距水体 ≤6 格（BFS）
  {
    const q = [];
    const dist = new Int16Array(SIZE * SIZE).fill(-1);
    for (let i = 0; i < SIZE * SIZE; i++) if (water[i]) { dist[i] = 0; q.push(i); }
    let head = 0;
    while (head < q.length) {
      const cur = q[head++], cx = cur % SIZE, cz = (cur / SIZE) | 0;
      if (dist[cur] >= IRRIGATION_RADIUS) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (!inMap(nx, nz)) continue;
        const ni = idx(nx, nz);
        if (dist[ni] === -1) { dist[ni] = dist[cur] + 1; if (!water[ni]) irrigated[ni] = 1; q.push(ni); }
      }
    }
  }

  // 4. 贸易站：两处，靠近对角区域的平地，整平 5×5
  const tradePosts = [
    placeTradePost(height, water, 36, 36, 60),
    placeTradePost(height, water, SIZE - 37, SIZE - 37, 60),
  ];

  // 5. 道路：A* 连接两个贸易站（过河成本高→自然形成少量"桥"格）
  const path = aStar(height, water, tradePosts[0], tradePosts[1]);
  for (const i of path) road[i] = 1;

  // 6. 生物群系
  for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    const i = idx(x, z), h = height[i];
    if (h >= 10) biome[i] = 2;
    else if (fbm(x * 0.045 + 200, z * 0.045 + 200, seed + 31) > 0.58 && h >= 2 && h <= 9) biome[i] = 1;
    else if (fbm(x * 0.09 + 99, z * 0.09 + 99, seed + 57) > 0.70) biome[i] = 3;
    else biome[i] = 0;
  }

  // 7. 资源节点（避开水/路/贸易站近旁）
  const nodes = [];
  let nodeId = 1;
  const nearPost = (x, z, r) => tradePosts.some(p => Math.abs(p.x - x) < r && Math.abs(p.z - z) < r);
  const freeCell = (x, z) => !water[idx(x, z)] && !road[idx(x, z)] && !nearPost(x, z, 7);
  for (let z = 2; z < SIZE - 2; z++) for (let x = 2; x < SIZE - 2; x++) {
    if (!freeCell(x, z)) continue;
    const i = idx(x, z), h = height[i], b = biome[i], r = hash2(x * 3 + 11, z * 3 + 7, seed + 77);
    if (b === 1 && r < 0.045) nodes.push({ id: nodeId++, type: 'tree', x, z, yield: 5, max: 5, respawn: 0 });
    else if (b !== 2 && h >= 5 && h <= 9 && r < 0.013) nodes.push({ id: nodeId++, type: 'rock', x, z, yield: 4, max: 4, respawn: 0 });
    else if (b === 2 && r < 0.040) nodes.push({ id: nodeId++, type: r < 0.018 ? 'iron' : 'copper', x, z, yield: 3, max: 3, respawn: 0 });
    else if (b === 0 && irrigated[i] && r > 0.90) nodes.push({ id: nodeId++, type: 'berry', x, z, yield: 3, max: 3, respawn: 0 });
  }

  // 7b. 矿脉保底：山地稀少的世界强制补足，保证武器产业链原料可得
  for (const oreType of ['iron', 'copper']) {
    let count = nodes.filter(n => n.type === oreType).length, tries = 0;
    while (count < 12 && tries++ < 6000) {
      const x = 4 + Math.floor(rng() * (SIZE - 8)), z = 4 + Math.floor(rng() * (SIZE - 8));
      const i = idx(x, z);
      if (height[i] >= 8 && !water[i] && !road[i] && !nearPost(x, z, 7)
        && !nodes.some(n => n.x === x && n.z === z)) {
        nodes.push({ id: nodeId++, type: oreType, x, z, yield: 3, max: 3, respawn: 0 });
        count++;
      }
    }
  }

  // 8. 野生动物初始分布（运动逻辑在 sim 中）
  const animals = [];
  let aid = 1;
  const scatter = (type, count, ok) => {
    let tries = 0;
    while (count > 0 && tries++ < 4000) {
      const x = 4 + Math.floor(rng() * (SIZE - 8)), z = 4 + Math.floor(rng() * (SIZE - 8));
      const i = idx(x, z);
      if (water[i] || road[i] || nearPost(x, z, 10) || !ok(biome[i], height[i])) continue;
      animals.push({ id: aid++, type, x: x + 0.5, z: z + 0.5 });
      count--;
    }
  };
  scatter('deer', 12, (b, h) => b === 0 || b === 1);
  scatter('boar', 8, (b, h) => b === 1);
  scatter('wolf', 10, (b, h) => (b === 1 || b === 2) && h >= 4);

  return { seed, size: SIZE, height, water, road, biome, irrigated, tradePosts, nodes, animals };
}

function carveRiver(height, water, rng, seed, frac) {
  // 起点：在地图 frac 比例的横带上找一处高地
  let best = -1, bestH = -1;
  for (let t = 0; t < 400; t++) {
    const x = 20 + Math.floor(rng() * (SIZE - 40));
    const z = Math.max(8, Math.min(SIZE - 9, Math.floor(frac * SIZE + (rng() - 0.5) * 60)));
    const h = height[idx(x, z)];
    if (h > bestH) { bestH = h; best = idx(x, z); }
  }
  let x = best % SIZE, z = (best / SIZE) | 0;
  const visited = new Set([best]);
  let steps = 0;
  while (steps++ < 2400) {
    const i = idx(x, z);
    water[i] = 1;
    if (height[i] > 0) height[i] = Math.max(0, height[i] - 1);
    // 加宽一格
    const side = rng() < 0.5 ? [1, 0] : [0, 1];
    const wx = x + side[0], wz = z + side[1];
    if (inMap(wx, wz)) { water[idx(wx, wz)] = 1; height[idx(wx, wz)] = Math.min(height[idx(wx, wz)], height[i]); }
    if (x <= 1 || z <= 1 || x >= SIZE - 2 || z >= SIZE - 2) break;   // 到达边缘
    // 选最低邻格（含对角；允许踏上水面但用访问记录防回流），必要时下挖防止死水洼
    let bx = x, bz = z, bh = 1e9;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = x + dx, nz = z + dz;
      if (!inMap(nx, nz)) continue;
      const ni = idx(nx, nz);
      if (visited.has(ni)) continue;
      const nh = height[ni] + rng() * 0.6 + (water[ni] ? 0.2 : 0);
      if (nh < bh) { bh = nh; bx = nx; bz = nz; }
    }
    if (bx === x && bz === z) break;
    const nbi = idx(bx, bz);
    visited.add(nbi);
    if (height[nbi] > height[i]) height[nbi] = height[i]; // 下挖
    x = bx; z = bz;
  }
}

function placeTradePost(height, water, cx, cz, searchR) {
  let best = null, bestScore = 1e9;
  for (let z = Math.max(4, cz - searchR); z < Math.min(SIZE - 4, cz + searchR); z += 2) {
    for (let x = Math.max(4, cx - searchR); x < Math.min(SIZE - 4, cx + searchR); x += 2) {
      let ok = true, hsum = 0;
      const h0 = height[idx(x, z)];
      for (let dz = -2; dz <= 2 && ok; dz++) for (let dx = -2; dx <= 2; dx++) {
        const i = idx(x + dx, z + dz);
        if (water[i] || Math.abs(height[i] - h0) > 2) { ok = false; break; }
        hsum += Math.abs(height[i] - h0);
      }
      if (!ok) continue;
      const score = hsum + (Math.abs(x - cx) + Math.abs(z - cz)) * 0.3;
      if (score < bestScore) { bestScore = score; best = { x, z }; }
    }
  }
  if (!best) best = { x: cx, z: cz };
  const h0 = height[idx(best.x, best.z)];
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    height[idx(best.x + dx, best.z + dz)] = h0;
    water[idx(best.x + dx, best.z + dz)] = 0;
  }
  return { x: best.x, z: best.z, h: h0 };
}

function aStar(height, water, a, b) {
  const open = [[0, idx(a.x, a.z)]];
  const came = new Int32Array(SIZE * SIZE).fill(-1);
  const g = new Float32Array(SIZE * SIZE).fill(Infinity);
  g[idx(a.x, a.z)] = 0;
  const target = idx(b.x, b.z);
  while (open.length) {
    let mi = 0;
    for (let k = 1; k < open.length; k++) if (open[k][0] < open[mi][0]) mi = k;
    const [, cur] = open.splice(mi, 1)[0];
    if (cur === target) break;
    const cx = cur % SIZE, cz = (cur / SIZE) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (!inMap(nx, nz)) continue;
      const ni = idx(nx, nz);
      const slope = Math.abs(height[ni] - height[cur]);
      if (slope > 3) continue;
      const cost = 1 + slope * 6 + (water[ni] ? 26 : 0);
      const ng = g[cur] + cost;
      if (ng < g[ni]) {
        g[ni] = ng; came[ni] = cur;
        open.push([ng + Math.abs(nx - b.x) + Math.abs(nz - b.z), ni]);
      }
    }
    if (open.length > 30000) break; // 保险阀
  }
  const path = [];
  let cur = target;
  while (cur !== -1 && cur !== idx(a.x, a.z)) { path.push(cur); cur = came[cur]; }
  return path;
}

export { idx, inMap };
