// 渲染层：只读模拟状态画画面，不写任何游戏逻辑状态。
import { hash2 } from '../sim/rng.js';
import { BLUEPRINTS, TICK_DT, DAY_LEN, DAY_PART } from '../sim/sim.js';

const T = window.THREE;
const CHUNK = 32;

export function darknessAt(t) {
  if (t < 280) return 0;
  if (t < 300) return (t - 280) / 20;
  if (t < 460) return 1;
  return 1 - (t - 460) / 20;
}

export function createScene(world, sim) {
  const S = world.size;
  const idx = (x, z) => z * S + x;
  const scene = new T.Scene();
  scene.background = new T.Color(0x07080d);
  scene.fog = new T.FogExp2(0x07080d, 0.026);
  const camera = new T.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 220);
  const CAM_OFF = new T.Vector3(11, 15.5, 11);
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // 光照（M0 昼夜调色板）
  const hemi = new T.HemisphereLight(0x26304a, 0x0a0810, 0.55);
  scene.add(hemi);
  const moon = new T.DirectionalLight(0x55668a, 0.28);
  moon.position.set(-30, 50, -20); scene.add(moon);
  const torch = new T.PointLight(0xff9944, 1.35, 22, 2);
  scene.add(torch);
  const PAL = {
    day: { bg: new T.Color(0x252b34), fogD: 0.017, sky: new T.Color(0x95a0b5), gnd: new T.Color(0x2e2b26), hI: 0.85, dir: new T.Color(0xaab3c5), dI: 0.5 },
    night: { bg: new T.Color(0x07080d), fogD: 0.026, sky: new T.Color(0x26304a), gnd: new T.Color(0x0a0810), hI: 0.55, dir: new T.Color(0x55668a), dI: 0.28 },
  };
  function applyLighting(d) {
    scene.background.lerpColors(PAL.day.bg, PAL.night.bg, d);
    scene.fog.color.copy(scene.background);
    scene.fog.density = PAL.day.fogD + (PAL.night.fogD - PAL.day.fogD) * d;
    hemi.color.lerpColors(PAL.day.sky, PAL.night.sky, d);
    hemi.groundColor.lerpColors(PAL.day.gnd, PAL.night.gnd, d);
    hemi.intensity = PAL.day.hI + (PAL.night.hI - PAL.day.hI) * d;
    moon.color.lerpColors(PAL.day.dir, PAL.night.dir, d);
    moon.intensity = PAL.day.dI + (PAL.night.dI - PAL.day.dI) * d;
  }

  // ---------- 地形分块 ----------
  const boxGeo = new T.BoxGeometry(1, 1, 1);
  const chunks = [];
  (function buildTerrain() {
    const col = new T.Color(), m = new T.Matrix4();
    for (let cz = 0; cz < S / CHUNK; cz++) for (let cx = 0; cx < S / CHUNK; cx++) {
      let count = 0;
      for (let z = cz * CHUNK; z < (cz + 1) * CHUNK; z++) for (let x = cx * CHUNK; x < (cx + 1) * CHUNK; x++) count += 3;
      const mesh = new T.InstancedMesh(boxGeo, new T.MeshLambertMaterial(), count);
      let i = 0;
      for (let z = cz * CHUNK; z < (cz + 1) * CHUNK; z++) for (let x = cx * CHUNK; x < (cx + 1) * CHUNK; x++) {
        const ci = idx(x, z), h = world.height[ci];
        const isWater = world.water[ci], isRoad = world.road[ci], b = world.biome[ci];
        for (let dy = 0; dy < 3; dy++) {
          const y = h - dy;
          m.makeTranslation(x, y, z); mesh.setMatrixAt(i, m);
          const sh = 0.8 + hash2(x * 3 + dy, z * 3 - dy, 5) * 0.4;
          if (dy > 0) col.setRGB(0.13 * sh, 0.11 * sh, 0.10 * sh);
          else if (isWater) col.setRGB(0.07, 0.13, 0.22);
          else if (isRoad) col.setRGB(0.26 * sh, 0.22 * sh, 0.17 * sh);
          else if (b === 2) col.setRGB(0.22 * sh, 0.22 * sh, 0.25 * sh);
          else if (b === 3) col.setRGB(0.20 * sh, 0.08 * sh, 0.26 * sh);
          else if (b === 1) col.setRGB(0.05 * sh, 0.13 * sh, 0.07 * sh);
          else col.setRGB(0.08 * sh, 0.16 * sh, 0.09 * sh);
          mesh.setColorAt(i, col); i++;
        }
      }
      mesh.position.set(0, 0, 0);
      mesh.userData.center = new T.Vector2(cx * CHUNK + CHUNK / 2, cz * CHUNK + CHUNK / 2);
      scene.add(mesh);
      chunks.push(mesh);
    }
  })();

  // ---------- 贸易站结构 ----------
  for (const p of world.tradePosts) {
    const g = new T.Group();
    const stone = new T.MeshLambertMaterial({ color: 0x4a4a52 });
    const cloth = new T.MeshLambertMaterial({ color: 0x8a6a2a, emissive: 0x332200 });
    for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      const pil = new T.Mesh(boxGeo, stone); pil.position.set(ox, 1.5, oz); pil.scale.set(0.6, 3, 0.6); g.add(pil);
    }
    const roof = new T.Mesh(boxGeo, cloth); roof.position.set(0, 3.2, 0); roof.scale.set(5.4, 0.3, 5.4); g.add(roof);
    const counter = new T.Mesh(boxGeo, new T.MeshLambertMaterial({ color: 0x5a4630 }));
    counter.position.set(0, 0.9, 0); counter.scale.set(2.4, 0.8, 1.0); g.add(counter);
    const lamp = new T.PointLight(0xffc966, 0.9, 14, 2);
    lamp.position.set(0, 2.6, 0); g.add(lamp);
    g.position.set(p.x, world.height[idx(p.x, p.z)] + 0.5, p.z);
    scene.add(g);
  }

  // ---------- 资源节点（实例化） ----------
  const _m4 = new T.Matrix4(), _q = new T.Quaternion(), _v3 = new T.Vector3(), _sc = new T.Vector3();
  const nodeMeshes = {};
  const nodeSlot = new Map(); // nodeId -> {type, slot}
  (function buildNodes() {
    const defs = {
      treeTrunk: { color: 0x2a1d12, sx: 0.35, sy: 2.2, sz: 0.35, oy: 1.1 },
      treeTop: { color: 0x12290f, sx: 1.7, sy: 1.6, sz: 1.7, oy: 2.7 },
      rock: { color: 0x5a5a62, sx: 1.0, sy: 0.8, sz: 1.0, oy: 0.4 },
      iron: { color: 0x7a8295, sx: 0.95, sy: 0.85, sz: 0.95, oy: 0.42 },
      copper: { color: 0x9a6a4a, sx: 0.95, sy: 0.85, sz: 0.95, oy: 0.42 },
      berry: { color: 0x3a5a30, sx: 0.85, sy: 0.6, sz: 0.85, oy: 0.3 },
    };
    const byType = {};
    for (const n of world.nodes) (byType[n.type] = byType[n.type] || []).push(n);
    const parts = { tree: ['treeTrunk', 'treeTop'], rock: ['rock'], iron: ['iron'], copper: ['copper'], berry: ['berry'] };
    for (const type in byType) {
      const list = byType[type];
      nodeMeshes[type] = parts[type].map(pk => {
        const def = defs[pk];
        const im = new T.InstancedMesh(boxGeo, new T.MeshLambertMaterial({ color: def.color }), list.length);
        im.userData.def = def;
        scene.add(im);
        return im;
      });
      list.forEach((n, slot) => {
        nodeSlot.set(n.id, { type, slot });
        setNodeMatrix(n, slot, 1);
      });
    }
  })();
  function setNodeMatrix(n, slot, scale) {
    const h = world.height[idx(n.x, n.z)] + 0.5;
    for (const im of nodeMeshes[n.type]) {
      const def = im.userData.def;
      _v3.set(n.x, h + def.oy * scale, n.z);
      _sc.set(def.sx * scale, def.sy * scale, def.sz * scale);
      _q.identity();
      _m4.compose(_v3, _q, _sc);
      im.setMatrixAt(slot, _m4);
      im.instanceMatrix.needsUpdate = true;
    }
  }
  function syncNodes() {
    for (const n of world.nodes) {
      const ns = sim.state.nodeState[n.id];
      const alive = !ns || ns.yield > 0;
      const ref = nodeSlot.get(n.id);
      setNodeMatrix(n, ref.slot, alive ? Math.max(0.4, (ns ? ns.yield : n.max) / n.max) : 0.001);
    }
  }

  // ---------- 小人与动物模型 ----------
  function buildHumanoid(skin, cloth, scale) {
    const g = new T.Group();
    const part = (color, x, y, z, sx, sy, sz) => {
      const mm = new T.Mesh(boxGeo, new T.MeshLambertMaterial({ color }));
      mm.position.set(x, y, z); mm.scale.set(sx, sy, sz); g.add(mm); return mm;
    };
    const legL = part(cloth, -0.16, 0.35, 0, 0.26, 0.7, 0.26);
    const legR = part(cloth, 0.16, 0.35, 0, 0.26, 0.7, 0.26);
    const body = part(cloth, 0, 1.05, 0, 0.62, 0.72, 0.36);
    const head = part(skin, 0, 1.75, 0, 0.5, 0.5, 0.5);
    const armL = part(skin, -0.44, 1.18, 0, 0.2, 0.62, 0.2);
    const armR = part(skin, 0.44, 1.18, 0, 0.2, 0.62, 0.2);
    g.scale.setScalar(scale || 1);
    return { group: g, legL, legR, armL, armR, body, head };
  }
  function buildQuadruped(color, bodyScale) {
    const g = new T.Group();
    const mat = new T.MeshLambertMaterial({ color });
    const body = new T.Mesh(boxGeo, mat);
    body.position.set(0, 0.6 * bodyScale, 0); body.scale.set(0.5 * bodyScale, 0.5 * bodyScale, 1.1 * bodyScale); g.add(body);
    const head = new T.Mesh(boxGeo, mat);
    head.position.set(0, 0.85 * bodyScale, 0.65 * bodyScale); head.scale.setScalar(0.35 * bodyScale); g.add(head);
    const legs = [];
    for (const [ox, oz] of [[-0.18, 0.35], [0.18, 0.35], [-0.18, -0.35], [0.18, -0.35]]) {
      const leg = new T.Mesh(boxGeo, mat);
      leg.position.set(ox * bodyScale, 0.2 * bodyScale, oz * bodyScale);
      leg.scale.set(0.12 * bodyScale, 0.45 * bodyScale, 0.12 * bodyScale);
      g.add(leg); legs.push(leg);
    }
    return { group: g, legs, body, head };
  }

  // 玩家
  const pModel = buildHumanoid(0xc9a87a, 0x1c2030, 1);
  const cape = new T.Mesh(new T.BoxGeometry(0.55, 0.85, 0.08), new T.MeshLambertMaterial({ color: 0x551015 }));
  cape.position.set(0, 1.05, 0.25); pModel.group.add(cape);
  const wepMesh = new T.Mesh(new T.BoxGeometry(0.12, 1.0, 0.12), new T.MeshLambertMaterial({ color: 0x999999 }));
  wepMesh.position.set(0, -0.5, -0.3); wepMesh.rotation.x = Math.PI / 2.4;
  pModel.armR.add(wepMesh);
  scene.add(pModel.group);
  let attackAnim = 0;

  // 实体池
  const zombieMap = new Map(), animalMap = new Map(), dropMap = new Map(), pileMap = new Map(), buildingMap = new Map();
  const fireballMeshes = [];
  const explosions = [];
  const fireGeo = new T.SphereGeometry(0.28, 10, 10);

  const ANIMAL_COLOR = { deer: 0x8a6a45, boar: 0x4a3528, wolf: 0x66686f };
  const RAR_HEX = [0xc8c8c8, 0x5b8cff, 0xffd24a, 0xff8c2e];

  function makeZombieModel(zb) {
    const mdl = zb.skel ? buildHumanoid(0xb8b4a4, 0x55524a, 0.92) : buildHumanoid(0x3f6b35, 0x23301f, 1);
    if (zb.breaker) mdl.head.material.emissive.setHex(0x771515); // 破坏者红眼

    const barG = new T.Group();
    const bg = new T.Mesh(new T.PlaneGeometry(1.1, 0.12), new T.MeshBasicMaterial({ color: 0x220a0a, side: T.DoubleSide, depthTest: false, transparent: true }));
    const fg = new T.Mesh(new T.PlaneGeometry(1.1, 0.12), new T.MeshBasicMaterial({ color: 0xb82a2a, side: T.DoubleSide, depthTest: false, transparent: true }));
    fg.position.z = 0.01; barG.add(bg); barG.add(fg);
    barG.position.y = 2.35; mdl.group.add(barG);
    mdl.fg = fg; mdl.barG = barG;
    scene.add(mdl.group);
    return mdl;
  }

  // ---------- 建筑 ----------
  function makeBuildingModel(b) {
    const g = new T.Group();
    const bp = BLUEPRINTS[b.type];
    const wood = new T.MeshLambertMaterial({ color: 0x4a3522 });
    const stone = new T.MeshLambertMaterial({ color: 0x55555e });
    const add = (mat, x, y, z, sx, sy, sz) => {
      const mm = new T.Mesh(boxGeo, mat); mm.position.set(x, y, z); mm.scale.set(sx, sy, sz); g.add(mm); return mm;
    };
    if (b.type === 'house') {
      add(wood, 0.5, 1.0, 0.5, 2, 2, 2);
      const roof = add(new T.MeshLambertMaterial({ color: 0x6e2a20 }), 0.5, 2.3, 0.5, 2.3, 0.6, 2.3);
      add(new T.MeshLambertMaterial({ color: 0x2a1d12 }), 0.5, 0.75, -0.55, 0.6, 1.5, 0.1); // 门
    } else if (b.type === 'farm') {
      add(new T.MeshLambertMaterial({ color: 0x3a2c1a }), 0, 0.06, 0, 0.95, 0.12, 0.95);
      const wheat = add(new T.MeshLambertMaterial({ color: 0xc9b252 }), 0, 0.3, 0, 0.7, 0.4, 0.7);
      g.userData.wheat = wheat;
    } else if (b.type === 'post') {
      add(wood, 0, 0.9, 0, 0.3, 1.8, 0.3);
    } else if (b.type === 'fence') {
      add(wood, 0, 0.6, 0, 0.9, 1.2, 0.18);
      add(wood, 0, 1.0, 0, 1.0, 0.12, 0.24);
    } else if (b.type === 'wall') {
      add(stone, 0, 1.0, 0, 1.0, 2.0, 0.85);
    } else if (b.type === 'gate') {
      add(stone, -0.42, 1.1, 0, 0.2, 2.2, 0.5);
      add(stone, 0.42, 1.1, 0, 0.2, 2.2, 0.5);
      const door = add(wood, 0, 0.9, 0, 0.68, 1.8, 0.14);
      g.userData.door = door;
    } else if (b.type === 'tower') {
      add(stone, 0, 1.8, 0, 0.95, 3.6, 0.95);
      add(wood, 0, 3.7, 0, 1.3, 0.2, 1.3);
      const lamp = new T.PointLight(0xff9944, 0.7, 10, 2);
      lamp.position.set(0, 4.2, 0); g.add(lamp);
    }
    const h = world.height[idx(b.x, b.z)] + 0.5;
    g.position.set(b.x + (bp.w - 1) / 2, h, b.z + (bp.d - 1) / 2);
    scene.add(g);
    return g;
  }
  function syncBuildings() {
    const seen = new Set();
    for (const b of sim.state.buildings) {
      seen.add(b.id);
      let g = buildingMap.get(b.id);
      if (!g) { g = makeBuildingModel(b); buildingMap.set(b.id, g); }
      // 工地半透明 + 进度上升
      const done = b.stage === 'done';
      const prog = done ? 1 : 0.25 + 0.75 * (b.progress / BLUEPRINTS[b.type].work);
      g.scale.y = prog;
      g.traverse(o => { if (o.isMesh) { o.material.transparent = !done; o.material.opacity = done ? 1 : 0.5; } });
      if (g.userData.wheat) {
        const f = b.farm;
        g.userData.wheat.visible = !!(f && f.planted);
        if (f && f.planted) {
          const k = Math.min(1, f.growT / (DAY_LEN * 2));
          g.userData.wheat.scale.set(0.7, 0.15 + 0.55 * k, 0.7);
          g.userData.wheat.position.y = 0.12 + (0.15 + 0.55 * k) / 2;
          g.userData.wheat.material.color.setHex(k >= 1 ? 0xe8c93a : 0x7a9a4a);
        }
      }
      if (g.userData.door) g.userData.door.visible = !b.open;
    }
    for (const [id, g] of buildingMap) if (!seen.has(id)) { scene.remove(g); buildingMap.delete(id); }
  }

  // ---------- 幽灵预览 ----------
  let ghost = null;
  function setGhost(type, x, z, ok) {
    clearGhost();
    const bp = BLUEPRINTS[type];
    ghost = new T.Mesh(boxGeo, new T.MeshLambertMaterial({
      color: ok ? 0x44cc66 : 0xcc4444, transparent: true, opacity: 0.45, depthWrite: false }));
    const h = world.height[idx(Math.max(0, Math.min(S - 1, x)), Math.max(0, Math.min(S - 1, z)))] + 0.5;
    ghost.position.set(x + (bp.w - 1) / 2, h + 1, z + (bp.d - 1) / 2);
    ghost.scale.set(bp.w, 2, bp.d);
    scene.add(ghost);
  }
  function clearGhost() { if (ghost) { scene.remove(ghost); ghost = null; } }

  // ---------- 事件应用（音效以外的视觉事件） ----------
  function applyEvents(events) {
    for (const ev of events) {
      if (ev.t === 'boom') {
        const boom = new T.Mesh(fireGeo, new T.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.85 }));
        const h = world.height[idx(Math.round(ev.x), Math.round(ev.z))] + 1.2;
        boom.position.set(ev.x, h, ev.z); scene.add(boom);
        explosions.push({ mesh: boom, t: 0 });
      } else if (ev.t === 'anim' && ev.n === 'attack') attackAnim = 0.3;
      else if (ev.t === 'nodeEmpty' || ev.t === 'day') syncNodes();
    }
  }

  // ---------- 每帧 ----------
  const camTarget = new T.Vector3();
  let visT = 0;
  function frame(dtReal) {
    const st = sim.state, p = st.player;
    const tDay = sim.tDay();
    const dark = darknessAt(tDay);
    applyLighting(dark);

    // 玩家
    pModel.group.position.lerp(_v3.set(p.x, sim.playerStandH(), p.z), Math.min(1, dtReal * 14));
    pModel.group.rotation.y = p.facing;
    pModel.group.visible = !p.dead;
    const moving = pModel.group.position.distanceToSquared(_v3) > 0.0004;
    const t = performance.now() / 1000;
    const wob = moving ? Math.sin(t * 11) * 0.55 : 0;
    pModel.legL.rotation.x = wob; pModel.legR.rotation.x = -wob;
    pModel.armL.rotation.x = -wob * 0.7;
    attackAnim = Math.max(0, attackAnim - dtReal);
    pModel.armR.rotation.x = attackAnim > 0 ? -2.0 * Math.sin(attackAnim / 0.3 * Math.PI) : wob * 0.7;
    wepMesh.material.color.setHex(p.weapon ? RAR_HEX[p.weapon.rarity] : 0x999999);
    torch.position.set(p.x, sim.groundH(p.x, p.z) + 2.4, p.z);
    torch.intensity = (1.3 + Math.sin(t * 9) * 0.09 + Math.random() * 0.07) * (0.45 + 0.55 * dark);

    // 丧尸
    const seenZ = new Set();
    for (const zb of st.zombies) {
      seenZ.add(zb.id);
      let mdl = zombieMap.get(zb.id);
      if (!mdl) { mdl = makeZombieModel(zb); zombieMap.set(zb.id, mdl); mdl.group.position.set(zb.x, sim.groundH(zb.x, zb.z), zb.z); }
      mdl.group.position.lerp(_v3.set(zb.x, sim.groundH(zb.x, zb.z), zb.z), Math.min(1, dtReal * 10));
      mdl.group.rotation.y = Math.atan2(p.x - zb.x, p.z - zb.z);
      const zwob = Math.sin((t + zb.id) * 8) * 0.5;
      mdl.legL.rotation.x = zwob; mdl.legR.rotation.x = -zwob;
      mdl.armL.rotation.x = -0.9 + zwob * 0.3; mdl.armR.rotation.x = -0.9 - zwob * 0.3;
      const ratio = Math.max(0, zb.hp / zb.hpMax);
      mdl.fg.scale.x = ratio; mdl.fg.position.x = -(1 - ratio) * 0.55;
      mdl.barG.quaternion.copy(camera.quaternion);
    }
    for (const [id, mdl] of zombieMap) if (!seenZ.has(id)) { scene.remove(mdl.group); zombieMap.delete(id); }

    // 动物
    const seenA = new Set();
    for (const an of st.animals) {
      seenA.add(an.id);
      let mdl = animalMap.get(an.id);
      if (!mdl) {
        mdl = buildQuadruped(ANIMAL_COLOR[an.type], an.type === 'boar' ? 1.1 : an.type === 'deer' ? 1.0 : 0.95);
        scene.add(mdl.group); animalMap.set(an.id, mdl);
        mdl.group.position.set(an.x, sim.groundH(an.x, an.z), an.z);
        mdl.lastX = an.x; mdl.lastZ = an.z;
      }
      mdl.group.position.lerp(_v3.set(an.x, sim.groundH(an.x, an.z), an.z), Math.min(1, dtReal * 10));
      if (Math.abs(an.x - mdl.lastX) + Math.abs(an.z - mdl.lastZ) > 0.01)
        mdl.group.rotation.y = Math.atan2(an.x - mdl.lastX, an.z - mdl.lastZ);
      mdl.lastX = an.x; mdl.lastZ = an.z;
      const awob = Math.sin((t + an.id) * 9) * 0.4;
      mdl.legs.forEach((leg, k) => leg.rotation.x = k % 2 ? awob : -awob);
    }
    for (const [id, mdl] of animalMap) if (!seenA.has(id)) { scene.remove(mdl.group); animalMap.delete(id); }

    // 掉落物 / 资源堆
    const seenD = new Set();
    for (const d of st.drops) {
      seenD.add(d.id);
      let mm = dropMap.get(d.id);
      if (!mm) {
        const color = d.kind === 'potion' ? 0xc01525 : d.kind === 'money' ? 0xffd24a : RAR_HEX[d.rarity];
        mm = new T.Mesh(boxGeo, new T.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.3 }));
        mm.scale.setScalar(d.kind === 'money' ? 0.3 : 0.4);
        scene.add(mm); dropMap.set(d.id, mm);
      }
      mm.position.set(d.x, sim.groundH(d.x, d.z) + 0.5 + Math.sin(t * 3 + d.id) * 0.12, d.z);
      mm.rotation.y += dtReal * 2.5;
    }
    for (const [id, mm] of dropMap) if (!seenD.has(id)) { scene.remove(mm); dropMap.delete(id); }
    const seenP = new Set();
    st.piles.forEach((pile, i) => {
      seenP.add(i);
      let mm = pileMap.get(i);
      if (!mm) {
        mm = new T.Mesh(boxGeo, new T.MeshLambertMaterial({ color: 0x8a7a55, emissive: 0x443a20 }));
        mm.scale.set(0.7, 0.5, 0.7); scene.add(mm); pileMap.set(i, mm);
      }
      mm.position.set(pile.x, sim.groundH(pile.x, pile.z) + 0.3, pile.z);
    });
    for (const [id, mm] of pileMap) if (!seenP.has(id)) { scene.remove(mm); pileMap.delete(id); }

    // 火球
    while (fireballMeshes.length < st.fireballs.length) {
      const mm = new T.Mesh(fireGeo, new T.MeshBasicMaterial({ color: 0xff7722 }));
      const light = new T.PointLight(0xff6622, 1.0, 7, 2); mm.add(light);
      scene.add(mm); fireballMeshes.push(mm);
    }
    while (fireballMeshes.length > st.fireballs.length) scene.remove(fireballMeshes.pop());
    st.fireballs.forEach((fb, i) => fireballMeshes[i].position.set(fb.x, sim.groundH(fb.x, fb.z) + 1.2, fb.z));

    // 爆炸
    for (let i = explosions.length - 1; i >= 0; i--) {
      const ex = explosions[i];
      ex.t += dtReal;
      ex.mesh.scale.setScalar(1 + ex.t * 28);
      ex.mesh.material.opacity = Math.max(0, 0.85 - ex.t * 3.4);
      if (ex.t > 0.25) { scene.remove(ex.mesh); explosions.splice(i, 1); }
    }

    syncBuildings();

    // 分块可见性（每0.5s一次）
    visT -= dtReal;
    if (visT <= 0) {
      visT = 0.5;
      for (const ch of chunks) {
        const c = ch.userData.center;
        ch.visible = (c.x - p.x) ** 2 + (c.y - p.z) ** 2 < 85 * 85;
      }
    }

    camTarget.set(p.x, sim.groundH(p.x, p.z), p.z);
    camera.position.lerp(_v3.copy(camTarget).add(CAM_OFF), Math.min(1, dtReal * 6));
    camera.lookAt(camTarget.x, camTarget.y + 1, camTarget.z);
    renderer.render(scene, camera);
    return dark;
  }

  // 鼠标瞄准
  const raycaster = new T.Raycaster();
  const aimPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  function aimPoint(ndc) {
    aimPlane.constant = -(sim.groundH(sim.state.player.x, sim.state.player.z));
    raycaster.setFromCamera(ndc, camera);
    const p = new T.Vector3();
    if (raycaster.ray.intersectPlane(aimPlane, p)) return { x: p.x, z: p.z };
    return null;
  }
  function worldToScreen(x, y, z) {
    const v = new T.Vector3(x, y, z).project(camera);
    return { sx: (v.x * 0.5 + 0.5) * innerWidth, sy: (-v.y * 0.5 + 0.5) * innerHeight };
  }

  return { renderer, camera, frame, applyEvents, setGhost, clearGhost, aimPoint, worldToScreen,
    buildMinimapCanvas: () => buildMinimap(world), syncNodes };
}

// 小地图底图（独立导出：开始界面选址时尚无场景）
export function buildMinimap(world) {
  const S = world.size;
  const idx = (x, z) => z * S + x;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
    const i = idx(x, z), o = i * 4;
    let r, g, b;
    const h = world.height[i];
    if (world.water[i]) { r = 30; g = 60; b = 110; }
    else if (world.road[i]) { r = 120; g = 100; b = 70; }
    else if (world.biome[i] === 2) { const k = 90 + h * 6; r = k; g = k; b = k + 10; }
    else if (world.biome[i] === 1) { r = 25; g = 60; b = 30; }
    else if (world.biome[i] === 3) { r = 70; g = 35; b = 90; }
    else { r = 45; g = 75; b = 45; }
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (const p of world.tradePosts) {
    ctx.fillStyle = '#ffd24a';
    ctx.fillRect(p.x - 3, p.z - 3, 6, 6);
  }
  return cv;
}
