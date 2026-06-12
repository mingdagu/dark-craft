// 模拟核心：固定 20Hz 推进的确定性世界。不依赖 DOM / Three.js。
// 输入 = 每 tick 一份序列化的控制状态（联机三纪律之"一切操作皆指令"）。
import { makeRng } from './rng.js';
import { generateWorld, SIZE, idx, inMap } from './world.js';

export const TICK_DT = 1 / 20;
export const DAY_LEN = 480, DAY_PART = 300;
export const SAVE_VERSION = 1;

// ---------- 数值表 v1（M1 部分，已获用户批准） ----------
export const BLUEPRINTS = {
  house: { name: '房屋', cost: { wood: 20, stone: 10 }, hp: 450, w: 2, d: 2, work: 20 },
  farm:  { name: '农田', cost: { wood: 5 }, hp: 40, w: 1, d: 1, work: 6, needIrrigation: true, walkable: true },
  post:  { name: '木桩', cost: { wood: 1 }, hp: 30, w: 1, d: 1, work: 2 },
  fence: { name: '木围栏', cost: { wood: 2 }, hp: 60, w: 1, d: 1, work: 3 },
  wall:  { name: '石城墙', cost: { stone: 4 }, hp: 200, w: 1, d: 1, work: 8 },
  gate:  { name: '城门', cost: { wood: 6, stone: 4 }, hp: 160, w: 1, d: 1, work: 10, gate: true },
  tower: { name: '高塔', cost: { wood: 10, stone: 8 }, hp: 250, w: 1, d: 1, work: 15 },
};
export const KITS = {
  farm: { name: '农夫（农田快手+4种子）', seeds: 4 },
  pick: { name: '矿工（采石挖矿快手）' },
  axe:  { name: '樵夫（伐木快手）' },
  bow:  { name: '猎人（猎物伤害高肉多）' },
};
const GATHER_TIME = { tree: 1.6, rock: 2.0, iron: 2.6, copper: 2.4, berry: 1.0 };
const GATHER_RES = { tree: 'wood', rock: 'stone', iron: 'iron', copper: 'copper', berry: 'fruit' };
const NODE_RESPAWN_DAYS = { berry: 1, tree: 3, rock: 4, iron: 5, copper: 5 };
const FOOD = { fruit: 15, wheat: 20, meat: 35 };
export const SELL_BASE = { wood: 1, stone: 1, fruit: 1, wheat: 1, meat: 2, copper: 3, iron: 4 };
export const BUY_PRICE = { seed: 2, potion: 8 };
const HUNGER_PER_SEC = 60 / DAY_LEN;
const START_MONEY = 50;
const FARM_GROW_SEC = DAY_LEN * 2;
const MELEE_RANGE = 2.7, MELEE_CD = 0.45, WORK_RANGE = 2.4;
const FIRE_COST = 12, FIRE_CD = 0.55, FIRE_SPEED = 15, FIRE_RADIUS = 2.8, FIRE_UNLOCK_LEVEL = 3;
const ZOMBIE_BUILDING_DPS = 0.8;
const TRADE_SAFE_R = 9;

const RARITIES = [
  { name: '普通', color: '#c8c8c8', mult: 1.0, w: 60 },
  { name: '魔法', color: '#5b8cff', mult: 1.35, w: 25 },
  { name: '稀有', color: '#ffd24a', mult: 1.8, w: 11 },
  { name: '传奇', color: '#ff8c2e', mult: 2.5, w: 4 },
];
const WEP_NAMES = ['断剑', '骨斧', '钉锤', '弯刀', '巨剑'];
const ARM_NAMES = ['皮甲', '锁甲', '鳞甲', '板甲', '符文甲'];
const ANIMAL_DEF = {
  deer: { hp: 14, dmg: 0, speed: 4.6, meat: 2, xp: 2, flee: 7 },
  boar: { hp: 30, dmg: 6, speed: 3.2, meat: 3, xp: 6, aggroWhenHit: true },
  wolf: { hp: 24, dmg: 7, speed: 3.8, meat: 1, xp: 10, aggro: 8 },
};

export function createSim(seed, kitKey, spawn, savedState) {
  const world = generateWorld(seed);
  const rng = makeRng(seed ^ 0x51ED2705);

  let s; // 全部可变状态（可序列化）
  if (savedState) {
    s = savedState;
    rng.setState(s.rngState);
  } else {
    s = {
      version: SAVE_VERSION, seed, tick: 0, day: 1,
      player: {
        x: spawn.x, z: spawn.z, facing: 0, hp: 100, maxHp: 100, mp: 50, maxMp: 50,
        hunger: 100, level: 1, xp: 0, xpNeed: 60, baseAtk: 10,
        weapon: null, armor: null, potions: 1, money: START_MONEY, kit: kitKey,
        inv: { wood: 0, stone: 0, iron: 0, copper: 0, fruit: 2, wheat: 0, meat: 0, seed: kitKey === 'farm' ? 4 : 0 },
        kills: 0, dead: false, respawnT: 0, meleeT: 0, fireT: 0, workNode: 0, gatherAcc: 0, home: null,
      },
      buildings: [], nextBid: 1,
      zombies: [], nextZid: 1, nightSpawned: 0,
      animals: world.animals.map(a => ({ ...a, hp: ANIMAL_DEF[a.type].hp, state: 'wander', dir: 0, t: 0, atkT: 0 })),
      nextAid: world.animals.length + 1,
      nodeState: {},            // id -> {yield, respawn}
      drops: [], nextDid: 1,    // 装备/药水/钱掉落
      piles: [],                // 死亡资源堆
      fireballs: [],
      trade: { supply: {} },
      rngState: 0,
    };
  }

  // 占用网格（运行时重建，不序列化）
  const occ = new Uint16Array(SIZE * SIZE);
  for (const b of s.buildings) if (b.stage === 'done') stampOcc(b, b.id);
  function stampOcc(b, v) {
    const bp = BLUEPRINTS[b.type];
    for (let dz = 0; dz < bp.d; dz++) for (let dx = 0; dx < bp.w; dx++) occ[idx(b.x + dx, b.z + dz)] = v;
  }
  const nodeYield = id => {
    const ns = s.nodeState[id];
    const base = world.nodes.find(n => n.id === id);
    return ns ? ns.yield : base.max;
  };

  const events = []; // 渲染/音频侧消费：{t:'sfx'|'text'|'boom'|'day', ...}
  const emit = e => { if (events.length < 200) events.push(e); };

  function groundH(fx, fz) {
    const x = Math.max(0, Math.min(SIZE - 1, Math.round(fx)));
    const z = Math.max(0, Math.min(SIZE - 1, Math.round(fz)));
    return world.height[idx(x, z)] + 0.5;
  }
  function isWater(fx, fz) { return !!world.water[idx(Math.round(fx), Math.round(fz))]; }
  function inTradeSafe(fx, fz) {
    return world.tradePosts.some(p => (p.x - fx) ** 2 + (p.z - fz) ** 2 < TRADE_SAFE_R * TRADE_SAFE_R);
  }
  function cellBlocked(x, z, who) { // who: 'player' | 'zombie' | 'animal'
    if (!inMap(x, z)) return true;
    const i = idx(x, z);
    if (world.water[i]) return true;
    const bid = occ[i];
    if (bid) {
      const b = s.buildings.find(bb => bb.id === bid);
      if (!b) return false;
      const bp = BLUEPRINTS[b.type];
      if (bp.walkable) return false;
      if (bp.gate && b.open) return false;
      if ((b.type === 'house' || b.type === 'tower') && who === 'player') return false; // 自家可进/塔可登顶
      return true;
    }
    return false;
  }
  function tryMove(e, nx, nz, who) {
    const cx = Math.round(e.x), cz = Math.round(e.z);
    const txc = Math.round(nx), tzc = Math.round(nz);
    // 坡度限制
    const slopeOk = (a, b) => Math.abs(world.height[idx(a, b)] - world.height[idx(cx, cz)]) <= 2;
    if (!cellBlocked(txc, cz, who) && slopeOk(txc, cz)) e.x = Math.max(1.2, Math.min(SIZE - 1.2, nx));
    if (!cellBlocked(Math.round(e.x), tzc, who) && Math.abs(world.height[idx(Math.round(e.x), tzc)] - world.height[idx(Math.round(e.x), cz)]) <= 2)
      e.z = Math.max(1.2, Math.min(SIZE - 1.2, nz));
  }

  // ---------- 战斗与掉落 ----------
  function rollRarity() {
    let r = rng() * 100;
    for (const ra of RARITIES) { if (r < ra.w) return ra; r -= ra.w; }
    return RARITIES[0];
  }
  function dropLoot(x, z) {
    if (rng() < 0.20) s.drops.push({ id: s.nextDid++, kind: 'potion', x, z, ttl: 40 });
    if (rng() < 0.18) s.drops.push({ id: s.nextDid++, kind: 'money', amount: 1 + Math.floor(rng() * 3), x, z, ttl: 40 });
    if (rng() < 0.22) {
      const rarity = rollRarity(), isWep = rng() < 0.5;
      const base = isWep ? 4 + s.player.level * 2.2 : 3 + s.player.level * 1.8;
      const power = Math.max(1, Math.round(base * rarity.mult * (0.85 + rng() * 0.3)));
      const names = isWep ? WEP_NAMES : ARM_NAMES;
      s.drops.push({ id: s.nextDid++, kind: isWep ? 'weapon' : 'armor', rarity: RARITIES.indexOf(rarity),
        power, name: rarity.name + '·' + names[Math.floor(rng() * names.length)], x, z, ttl: 40 });
    }
  }
  function gainXp(n) {
    const p = s.player;
    p.xp += n;
    while (p.xp >= p.xpNeed) {
      p.xp -= p.xpNeed; p.level++;
      p.xpNeed = Math.round(p.xpNeed * 1.45);
      p.maxHp += 18; p.baseAtk += 3; p.hp = p.maxHp; p.mp = p.maxMp;
      emit({ t: 'sfx', n: 'levelUp' });
      emit({ t: 'text', x: p.x, z: p.z, text: '等级提升！LV ' + p.level, color: '#ffe27a', size: 22 });
      if (p.level === FIRE_UNLOCK_LEVEL) emit({ t: 'text', x: p.x, z: p.z, text: '火球术已觉醒（右键）', color: '#ff8c2e', size: 18 });
    }
  }
  function atk() { return s.player.baseAtk + (s.player.weapon ? s.player.weapon.power : 0); }
  function hurtZombie(zb, dmg, fromFire) {
    zb.hp -= dmg;
    emit({ t: 'text', x: zb.x, z: zb.z, text: Math.round(dmg), color: fromFire ? '#ff9a3e' : '#ffd9b0', size: fromFire ? 18 : 15 });
    if (zb.hp <= 0) {
      s.zombies.splice(s.zombies.indexOf(zb), 1);
      s.player.kills++;
      emit({ t: 'sfx', n: 'monDie' });
      gainXp(12); dropLoot(zb.x, zb.z);
    } else emit({ t: 'sfx', n: 'monHit' });
  }
  function hurtAnimal(an, dmg) {
    const def = ANIMAL_DEF[an.type];
    const bonus = s.player.kit === 'bow' ? 1.5 : 1;
    an.hp -= dmg * bonus;
    emit({ t: 'text', x: an.x, z: an.z, text: Math.round(dmg * bonus), color: '#ffd9b0', size: 14 });
    if (def.aggroWhenHit || an.type === 'wolf') an.state = 'attack';
    else an.state = 'flee';
    if (an.hp <= 0) {
      s.animals.splice(s.animals.indexOf(an), 1);
      emit({ t: 'sfx', n: 'monDie' });
      const meat = def.meat + (s.player.kit === 'bow' ? 1 : 0);
      s.player.inv.meat += meat;
      gainXp(def.xp);
      emit({ t: 'text', x: an.x, z: an.z, text: '+' + meat + ' 肉', color: '#ff9a8a', size: 14 });
    } else emit({ t: 'sfx', n: 'monHit' });
  }
  function hurtPlayer(dmg) {
    const p = s.player;
    if (p.dead) return;
    const armorP = p.armor ? p.armor.power : 0;
    const real = Math.max(1, Math.round(dmg * 50 / (50 + armorP)));
    p.hp -= real;
    emit({ t: 'sfx', n: 'playerHit' });
    emit({ t: 'text', x: p.x, z: p.z, text: '-' + real, color: '#ff4444', size: 16 });
    emit({ t: 'flash' });
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true; p.respawnT = 3;
      // M1 临时规则：背包资源原地掉落成堆，回家复活（M2 接转世）
      const inv = { ...p.inv };
      if (Object.values(inv).some(v => v > 0)) {
        s.piles.push({ x: p.x, z: p.z, inv, ttl: DAY_LEN });
        for (const k in p.inv) p.inv[k] = 0;
      }
      emit({ t: 'death' });
    }
  }

  // ---------- 建造 ----------
  function canPlace(type, x, z) {
    const bp = BLUEPRINTS[type];
    if (!bp) return { ok: false, why: '未知蓝图' };
    for (const k in bp.cost) if ((s.player.inv[k] || 0) < bp.cost[k]) return { ok: false, why: '材料不足' };
    const h0 = world.height[idx(x, z)];
    for (let dz = 0; dz < bp.d; dz++) for (let dx = 0; dx < bp.w; dx++) {
      const cx = x + dx, cz = z + dz;
      if (!inMap(cx, cz)) return { ok: false, why: '越界' };
      const i = idx(cx, cz);
      if (world.water[i]) return { ok: false, why: '不能建在水上' };
      if (world.road[i]) return { ok: false, why: '不能占用道路' };
      if (occ[i]) return { ok: false, why: '位置已被占用' };
      if (s.buildings.some(b => b.stage === 'site' && cx >= b.x && cx < b.x + BLUEPRINTS[b.type].w && cz >= b.z && cz < b.z + BLUEPRINTS[b.type].d))
        return { ok: false, why: '与工地重叠' };
      if (Math.abs(world.height[i] - h0) > 1) return { ok: false, why: '地面不平' };
      if (world.nodes.some(n => n.x === cx && n.z === cz && nodeYield(n.id) > 0)) return { ok: false, why: '有资源阻挡' };
      if (inTradeSafe(cx, cz)) return { ok: false, why: '贸易站中立区' };
      if (bp.needIrrigation && !world.irrigated[i]) return { ok: false, why: '农田需在河流灌溉范围内' };
    }
    return { ok: true };
  }
  function place(type, x, z) {
    const chk = canPlace(type, x, z);
    if (!chk.ok) { emit({ t: 'text', x: s.player.x, z: s.player.z, text: chk.why, color: '#ff7766', size: 14 }); return; }
    const bp = BLUEPRINTS[type];
    for (const k in bp.cost) s.player.inv[k] -= bp.cost[k];
    s.buildings.push({ id: s.nextBid++, type, x, z, stage: 'site', progress: 0, hp: bp.hp, hpMax: bp.hp,
      open: false, farm: bp.needIrrigation ? { planted: false, growT: 0 } : undefined });
    emit({ t: 'sfx', n: 'pickup', tier: 0 });
  }
  function completeBuilding(b) {
    b.stage = 'done';
    stampOcc(b, b.id);
    if (b.type === 'house' && !s.player.home) s.player.home = { x: b.x + 0.5, z: b.z + 0.5 };
    gainXp(5);
    emit({ t: 'sfx', n: 'levelUp' });
    emit({ t: 'text', x: b.x, z: b.z, text: BLUEPRINTS[b.type].name + ' 完工', color: '#9fdc7a', size: 16 });
  }
  function damageBuilding(b, dmg) {
    b.hp -= dmg;
    if (b.hp <= 0) {
      stampOcc(b, 0);
      s.buildings.splice(s.buildings.indexOf(b), 1);
      if (s.player.home && b.type === 'house' && Math.round(s.player.home.x - 0.5) === b.x && Math.round(s.player.home.z - 0.5) === b.z)
        s.player.home = null;
      emit({ t: 'boom', x: b.x, z: b.z });
      emit({ t: 'text', x: b.x, z: b.z, text: BLUEPRINTS[b.type].name + ' 被摧毁！', color: '#ff5544', size: 18 });
    }
  }

  // ---------- 主推进 ----------
  function step(input) {
    // input: { move:{x,z}, facing, aim:{x,z}, work, fire, actions:[{a:...}] }
    s.tick++;
    const p = s.player;
    const tDay = (s.tick * TICK_DT) % DAY_LEN;
    const newDay = Math.floor(s.tick * TICK_DT / DAY_LEN) + 1;
    if (newDay !== s.day) { s.day = newDay; onNewDay(); }
    const isNight = tDay >= DAY_PART;

    // 玩家
    if (!p.dead) {
      p.facing = input.facing ?? p.facing;
      if (input.move && (input.move.x || input.move.z)) {
        const len = Math.hypot(input.move.x, input.move.z) || 1;
        tryMove(p, p.x + input.move.x / len * 6.2 * TICK_DT, p.z + input.move.z / len * 6.2 * TICK_DT, 'player');
      }
      p.meleeT = Math.max(0, p.meleeT - TICK_DT);
      p.fireT = Math.max(0, p.fireT - TICK_DT);
      p.mp = Math.min(p.maxMp, p.mp + 6 * TICK_DT);
      p.hunger = Math.max(0, p.hunger - HUNGER_PER_SEC * TICK_DT);
      if (p.hunger <= 0) { p.hp -= 2 * TICK_DT; if (p.hp <= 0) hurtPlayer(1); }
      else if (p.hunger > 30) p.hp = Math.min(p.maxHp, p.hp + 0.8 * TICK_DT);

      for (const act of input.actions || []) doAction(act);
      if (input.work) doWork(input.aim);
      if (input.fire) castFireball();
    } else {
      p.respawnT -= TICK_DT;
      if (p.respawnT <= 0) {
        p.dead = false;
        const at = p.home || spawn;
        p.x = at.x; p.z = at.z;
        p.hp = Math.round(p.maxHp * 0.5); p.hunger = Math.max(p.hunger, 50); p.mp = p.maxMp;
        emit({ t: 'respawn' });
      }
    }

    // 火球
    for (let i = s.fireballs.length - 1; i >= 0; i--) {
      const fb = s.fireballs[i];
      fb.life -= TICK_DT;
      fb.x += fb.dx * FIRE_SPEED * TICK_DT; fb.z += fb.dz * FIRE_SPEED * TICK_DT;
      let hit = fb.life <= 0;
      if (!hit) for (const zb of s.zombies) if ((zb.x - fb.x) ** 2 + (zb.z - fb.z) ** 2 < 1.56) { hit = true; break; }
      if (!hit) for (const an of s.animals) if ((an.x - fb.x) ** 2 + (an.z - fb.z) ** 2 < 1.56) { hit = true; break; }
      if (hit) {
        emit({ t: 'sfx', n: 'fireBoom' }); emit({ t: 'boom', x: fb.x, z: fb.z });
        const dmg = atk() * 1.6;
        for (let k = s.zombies.length - 1; k >= 0; k--) {
          const zb = s.zombies[k];
          if ((zb.x - fb.x) ** 2 + (zb.z - fb.z) ** 2 < FIRE_RADIUS * FIRE_RADIUS) hurtZombie(zb, dmg * (0.9 + rng() * 0.2), true);
        }
        for (let k = s.animals.length - 1; k >= 0; k--) {
          const an = s.animals[k];
          if ((an.x - fb.x) ** 2 + (an.z - fb.z) ** 2 < FIRE_RADIUS * FIRE_RADIUS) hurtAnimal(an, dmg * 0.9);
        }
        s.fireballs.splice(i, 1);
      }
    }

    // 丧尸：夜间分批刷新
    if (isNight) {
      const target = Math.min(4 + (s.day - 1), 40);
      if (s.nightSpawned < target && s.tick % 40 === 0) spawnZombie();
    } else if (s.zombies.length && s.tick % 10 === 0) {
      // 黎明退散：逐只消失
      const zb = s.zombies[0];
      emit({ t: 'text', x: zb.x, z: zb.z, text: '化为尘土', color: '#888', size: 12 });
      s.zombies.shift();
    }
    if (!isNight) s.nightSpawned = 0;

    // 玩家是否在完好自宅的格子上（屋内庇护：丧尸攻击房屋而不是人）
    const shelterId = (() => {
      const bid = occ[idx(Math.round(p.x), Math.round(p.z))];
      if (!bid) return 0;
      const b = s.buildings.find(bb => bb.id === bid);
      return b && (b.type === 'house' || b.type === 'tower') && b.stage === 'done' ? bid : 0;
    })();

    // 丧尸 AI
    for (const zb of s.zombies) {
      zb.atkT = Math.max(0, zb.atkT - TICK_DT);
      const dp = Math.hypot(p.x - zb.x, p.z - zb.z);
      let tx, tz;
      if (!p.dead && dp < 18 && !inTradeSafe(p.x, p.z)) { tx = p.x; tz = p.z; }
      else if (p.home) { tx = p.home.x; tz = p.home.z; }
      else { tx = zb.x + Math.cos(zb.id * 2.3) * 3; tz = zb.z + Math.sin(zb.id * 1.7) * 3; }
      const d = Math.hypot(tx - zb.x, tz - zb.z);
      if (shelterId && dp < 2.2 && zb.atkT <= 0) {
        const hb = s.buildings.find(bb => bb.id === shelterId);
        if (hb) { zb.atkT = 1; damageBuilding(hb, ZOMBIE_BUILDING_DPS); emit({ t: 'sfx', n: 'monHit' }); }
      }
      else if (!p.dead && !shelterId && dp < 1.7 && zb.atkT <= 0) { zb.atkT = 1; hurtPlayer(zb.dmg * (0.9 + rng() * 0.2)); }
      else if (d > 1.2) {
        const nx = zb.x + (tx - zb.x) / d * zb.speed * TICK_DT;
        const nz = zb.z + (tz - zb.z) / d * zb.speed * TICK_DT;
        const cellX = Math.round(nx), cellZ = Math.round(nz);
        const bid = occ[idx(cellX, cellZ)];
        if (bid && cellBlocked(cellX, cellZ, 'zombie')) {
          const b = s.buildings.find(bb => bb.id === bid);
          if (b && zb.atkT <= 0) { zb.atkT = 1; damageBuilding(b, ZOMBIE_BUILDING_DPS); emit({ t: 'sfx', n: 'monHit' }); emit({ t: 'text', x: b.x, z: b.z, text: '咔嚓…', color: '#cc9966', size: 12 }); }
        } else {
          const ox = zb.x, oz = zb.z;
          tryMove(zb, nx, nz, 'zombie');
          if (Math.abs(zb.x - ox) < 0.001 && Math.abs(zb.z - oz) < 0.001) { // 卡住小幅绕行
            tryMove(zb, zb.x + (rng() - 0.5), zb.z + (rng() - 0.5), 'zombie');
          }
        }
      }
    }

    // 动物 AI
    for (const an of s.animals) {
      const def = ANIMAL_DEF[an.type];
      an.t -= TICK_DT; an.atkT = Math.max(0, an.atkT - TICK_DT);
      const dp = Math.hypot(p.x - an.x, p.z - an.z);
      if (an.type === 'wolf' && an.state === 'wander' && dp < def.aggro && !p.dead && !inTradeSafe(p.x, p.z)) an.state = 'attack';
      if (an.type === 'deer' && dp < def.flee) an.state = 'flee';
      if (an.state === 'attack' && !p.dead) {
        if (dp < 1.5) { if (an.atkT <= 0) { an.atkT = 1.1; hurtPlayer(def.dmg); } }
        else if (dp > 16) an.state = 'wander';
        else tryMove(an, an.x + (p.x - an.x) / dp * def.speed * TICK_DT, an.z + (p.z - an.z) / dp * def.speed * TICK_DT, 'animal');
      } else if (an.state === 'flee') {
        if (dp > 14) an.state = 'wander';
        else if (dp > 0.1) tryMove(an, an.x - (p.x - an.x) / dp * def.speed * TICK_DT, an.z - (p.z - an.z) / dp * def.speed * TICK_DT, 'animal');
      } else {
        if (an.t <= 0) { an.t = 2 + rng() * 4; an.dir = rng() * Math.PI * 2; }
        tryMove(an, an.x + Math.cos(an.dir) * 0.8 * TICK_DT, an.z + Math.sin(an.dir) * 0.8 * TICK_DT, 'animal');
      }
    }

    // 农田生长
    for (const b of s.buildings) {
      if (b.farm && b.stage === 'done' && b.farm.planted && b.farm.growT < FARM_GROW_SEC) {
        b.farm.growT += TICK_DT;
      }
    }

    // 掉落物：拾取与过期
    for (let i = s.drops.length - 1; i >= 0; i--) {
      const d = s.drops[i];
      d.ttl -= TICK_DT;
      if (d.ttl <= 0) { s.drops.splice(i, 1); continue; }
      if (!p.dead && (d.x - p.x) ** 2 + (d.z - p.z) ** 2 < 2.25) {
        if (d.kind === 'potion') { p.potions++; emit({ t: 'text', x: p.x, z: p.z, text: '+1 生命药水', color: '#ff7a8a', size: 14 }); emit({ t: 'sfx', n: 'pickup', tier: 0 }); }
        else if (d.kind === 'money') { p.money += d.amount; emit({ t: 'text', x: p.x, z: p.z, text: '+' + d.amount + ' 金', color: '#ffd24a', size: 14 }); emit({ t: 'sfx', n: 'pickup', tier: 0 }); }
        else {
          const slot = d.kind === 'weapon' ? 'weapon' : 'armor';
          const cur = p[slot];
          if (!cur || d.power > cur.power) {
            p[slot] = { name: d.name, power: d.power, rarity: d.rarity };
            emit({ t: 'sfx', n: 'pickup', tier: d.rarity });
            emit({ t: 'text', x: p.x, z: p.z, text: '拾取 ' + d.name + '（' + (slot === 'weapon' ? '攻击+' : '防御+') + d.power + '）', color: RARITIES[d.rarity].color, size: 16 });
          }
        }
        s.drops.splice(i, 1);
      }
    }
    for (let i = s.piles.length - 1; i >= 0; i--) {
      const pile = s.piles[i];
      pile.ttl -= TICK_DT;
      if (pile.ttl <= 0) { s.piles.splice(i, 1); continue; }
      if (!p.dead && (pile.x - p.x) ** 2 + (pile.z - p.z) ** 2 < 2.25) {
        for (const k in pile.inv) p.inv[k] = (p.inv[k] || 0) + pile.inv[k];
        emit({ t: 'text', x: p.x, z: p.z, text: '取回了遗落的物资', color: '#9fdc7a', size: 15 });
        emit({ t: 'sfx', n: 'pickup', tier: 1 });
        s.piles.splice(i, 1);
      }
    }

    s.rngState = rng.getState();
    const out = events.slice();
    events.length = 0;
    return out;
  }

  function onNewDay() {
    for (const k in s.trade.supply) s.trade.supply[k] *= 0.5;
    // 资源点再生
    for (const n of world.nodes) {
      const ns = s.nodeState[n.id];
      if (ns && ns.yield <= 0) {
        ns.respawn = (ns.respawn || 0) + 1;
        if (ns.respawn >= NODE_RESPAWN_DAYS[n.type]) { ns.yield = n.max; ns.respawn = 0; }
      }
    }
    // 动物补充
    for (const type of ['deer', 'boar', 'wolf']) {
      const want = { deer: 12, boar: 8, wolf: 10 }[type];
      if (s.animals.filter(a => a.type === type).length < want) {
        let tries = 0;
        while (tries++ < 200) {
          const x = 4 + rng() * (SIZE - 8), z = 4 + rng() * (SIZE - 8);
          if (Math.hypot(x - s.player.x, z - s.player.z) > 40 && !isWater(x, z)) {
            s.animals.push({ id: s.nextAid++, type, x, z, hp: ANIMAL_DEF[type].hp, state: 'wander', dir: 0, t: 0, atkT: 0 });
            break;
          }
        }
      }
    }
    emit({ t: 'day', day: s.day });
    emit({ t: 'autosave' });
  }

  function spawnZombie() {
    const p = s.player;
    let tries = 0;
    while (tries++ < 60) {
      const a = rng() * Math.PI * 2, d = 26 + rng() * 18;
      const x = Math.max(2, Math.min(SIZE - 2, p.x + Math.cos(a) * d));
      const z = Math.max(2, Math.min(SIZE - 2, p.z + Math.sin(a) * d));
      if (isWater(x, z) || inTradeSafe(x, z)) continue;
      const skel = rng() < 0.4;
      const lv = s.day;
      s.zombies.push({
        id: s.nextZid++, skel, x, z,
        hp: Math.round((skel ? 20 : 32) * (1 + 0.18 * (lv - 1))),
        hpMax: Math.round((skel ? 20 : 32) * (1 + 0.18 * (lv - 1))),
        dmg: Math.round((skel ? 6 : 8) * (1 + 0.12 * (lv - 1))),
        speed: (skel ? 3.4 : 2.3) * (0.9 + rng() * 0.25), atkT: 0,
      });
      s.nightSpawned++;
      return;
    }
  }

  function castFireball() {
    const p = s.player;
    if (p.level < FIRE_UNLOCK_LEVEL) return;
    if (p.mp < FIRE_COST || p.fireT > 0) return;
    p.mp -= FIRE_COST; p.fireT = FIRE_CD;
    emit({ t: 'sfx', n: 'fireCast' }); emit({ t: 'anim', n: 'attack' });
    s.fireballs.push({ x: p.x + Math.sin(p.facing) * 0.9, z: p.z + Math.cos(p.facing) * 0.9,
      dx: Math.sin(p.facing), dz: Math.cos(p.facing), life: 1.4 });
  }

  function doWork(aim) {
    const p = s.player;
    // 1) 近战目标优先（丧尸/动物在挥砍范围内）
    if (p.meleeT <= 0) {
      const fwdX = Math.sin(p.facing), fwdZ = Math.cos(p.facing);
      let struck = false;
      const strike = (list, hurtFn) => {
        for (let i = list.length - 1; i >= 0; i--) {
          const e = list[i];
          const dx = e.x - p.x, dz = e.z - p.z, dist = Math.hypot(dx, dz);
          if (dist < MELEE_RANGE && (dx * fwdX + dz * fwdZ) / (dist || 1) > 0.34) {
            hurtFn(e, atk() * (0.85 + rng() * 0.3)); struck = true;
          }
        }
      };
      strike(s.zombies, (e, d) => hurtZombie(e, d, false));
      strike(s.animals, (e, d) => hurtAnimal(e, d));
      if (struck) { p.meleeT = MELEE_CD; emit({ t: 'sfx', n: 'melee' }); emit({ t: 'anim', n: 'attack' }); p.gatherAcc = 0; return; }
    }
    // 2) 采集/施工/收获（瞄准格在工作半径内）
    if (!aim) return;
    const ax = Math.round(aim.x), az = Math.round(aim.z);
    if (Math.hypot(ax - p.x, az - p.z) > WORK_RANGE + 1.2) { p.gatherAcc = 0; return; }
    // 优先级：精确命中的工地/农田 > 资源节点（±1 模糊） > 模糊命中的工地/农田
    const siteAt = slack => s.buildings.find(b => b.stage === 'site'
      && ax >= b.x - slack && ax < b.x + BLUEPRINTS[b.type].w + slack
      && az >= b.z - slack && az < b.z + BLUEPRINTS[b.type].d + slack);
    const farmAt = slack => s.buildings.find(b => b.farm && b.stage === 'done'
      && Math.abs(b.x - ax) <= slack && Math.abs(b.z - az) <= slack);
    const exactSite = siteAt(0), exactFarm = farmAt(0);
    if (exactSite) { workSite(exactSite); return; }
    if (exactFarm) { workFarm(exactFarm); return; }
    // 资源节点
    const node = world.nodes.find(n => Math.abs(n.x - ax) <= 1 && Math.abs(n.z - az) <= 1 && nodeYield(n.id) > 0);
    if (node) {
      let speed = 1;
      if (s.player.kit === 'axe' && node.type === 'tree') speed = 1.6;
      if (s.player.kit === 'pick' && (node.type === 'rock' || node.type === 'iron' || node.type === 'copper')) speed = 1.6;
      p.gatherAcc += TICK_DT * speed;
      if (s.tick % 8 === 0) emit({ t: 'anim', n: 'attack' });
      if (p.gatherAcc >= GATHER_TIME[node.type]) {
        p.gatherAcc = 0;
        if (!s.nodeState[node.id]) s.nodeState[node.id] = { yield: node.max, respawn: 0 };
        s.nodeState[node.id].yield--;
        const res = GATHER_RES[node.type];
        p.inv[res]++;
        gainXp(1);
        emit({ t: 'sfx', n: 'melee' });
        emit({ t: 'text', x: node.x, z: node.z, text: '+1 ' + RES_NAMES[res], color: '#cfe3a0', size: 13 });
        if (s.nodeState[node.id].yield <= 0) emit({ t: 'nodeEmpty', id: node.id });
      }
      return;
    }
    // 模糊匹配兜底
    const site = siteAt(1);
    if (site) { workSite(site); return; }
    const farm = farmAt(1);
    if (farm) { workFarm(farm); return; }
    p.gatherAcc = 0;
  }

  function workSite(site) {
    const speed = (s.player.kit === 'farm' && site.type === 'farm') ? 1.5 : 1;
    site.progress += TICK_DT * speed;
    if (s.tick % 8 === 0) emit({ t: 'anim', n: 'attack' });
    if (site.progress >= BLUEPRINTS[site.type].work) completeBuilding(site);
  }

  function workFarm(farm) {
    const p = s.player;
    if (farm.farm.planted && farm.farm.growT >= FARM_GROW_SEC) {
      farm.farm.planted = false; farm.farm.growT = 0;
      p.inv.wheat += 4; gainXp(2);
      emit({ t: 'sfx', n: 'pickup', tier: 0 });
      emit({ t: 'text', x: farm.x, z: farm.z, text: '+4 小麦', color: '#e8d27a', size: 15 });
    } else if (!farm.farm.planted && p.inv.seed > 0) {
      p.inv.seed--; farm.farm.planted = true; farm.farm.growT = 0;
      emit({ t: 'text', x: farm.x, z: farm.z, text: '已播种', color: '#9fdc7a', size: 13 });
    }
    p.gatherAcc = 0;
  }

  function doAction(act) {
    const p = s.player;
    switch (act.a) {
      case 'place': place(act.type, act.x, act.z); break;
      case 'demolish': {
        const b = s.buildings.find(bb => bb.id === act.id);
        if (!b) break;
        if (Math.hypot(b.x - p.x, b.z - p.z) > 5) break;
        const bp = BLUEPRINTS[b.type];
        if (b.stage === 'done') stampOcc(b, 0);
        s.buildings.splice(s.buildings.indexOf(b), 1);
        for (const k in bp.cost) {
          const back = Math.floor(bp.cost[k] * 0.5);
          if (back > 0) p.inv[k] += back;
        }
        if (p.home && b.type === 'house' && Math.round(p.home.x - 0.5) === b.x && Math.round(p.home.z - 0.5) === b.z) p.home = null;
        emit({ t: 'text', x: b.x, z: b.z, text: '已拆除（返还半数材料）', color: '#cccccc', size: 13 });
        break;
      }
      case 'toggleGate': {
        const b = s.buildings.find(bb => bb.id === act.id && bb.stage === 'done' && BLUEPRINTS[bb.type].gate);
        if (b && Math.hypot(b.x - p.x, b.z - p.z) < 4) { b.open = !b.open; emit({ t: 'text', x: b.x, z: b.z, text: b.open ? '城门已开' : '城门已关', color: '#cfc4b0', size: 13 }); }
        break;
      }
      case 'eat': {
        for (const food of ['fruit', 'wheat', 'meat']) {
          if (p.inv[food] > 0 && p.hunger <= 100 - FOOD[food] * 0.5) {
            p.inv[food]--;
            p.hunger = Math.min(100, p.hunger + FOOD[food]);
            emit({ t: 'sfx', n: 'potion' });
            emit({ t: 'text', x: p.x, z: p.z, text: '吃了' + RES_NAMES[food] + '（饱食+' + FOOD[food] + '）', color: '#9fdc7a', size: 14 });
            break;
          }
        }
        break;
      }
      case 'potion': {
        if (p.potions > 0 && p.hp < p.maxHp && !p.dead) {
          p.potions--;
          const heal = Math.round(p.maxHp * 0.4);
          p.hp = Math.min(p.maxHp, p.hp + heal);
          emit({ t: 'sfx', n: 'potion' });
          emit({ t: 'text', x: p.x, z: p.z, text: '+' + heal, color: '#4aff7a', size: 18 });
        }
        break;
      }
      case 'sell': {
        if (!nearTradePost()) break;
        const qty = Math.min(act.qty || 1, p.inv[act.item] || 0);
        if (qty <= 0 || !SELL_BASE[act.item]) break;
        const total = Math.max(1, Math.round(sellPrice(act.item) * qty));
        p.inv[act.item] -= qty;
        p.money += total;
        s.trade.supply[act.item] = (s.trade.supply[act.item] || 0) + qty;
        emit({ t: 'sfx', n: 'pickup', tier: 0 });
        emit({ t: 'text', x: p.x, z: p.z, text: '卖出 ' + qty + ' ' + RES_NAMES[act.item] + '，+' + total + ' 金', color: '#ffd24a', size: 14 });
        break;
      }
      case 'buy': {
        if (!nearTradePost()) break;
        const cost = BUY_PRICE[act.item];
        if (!cost || p.money < cost) break;
        p.money -= cost;
        if (act.item === 'seed') p.inv.seed++;
        if (act.item === 'potion') p.potions++;
        emit({ t: 'sfx', n: 'pickup', tier: 1 });
        break;
      }
    }
  }
  function nearTradePost() { return inTradeSafe(s.player.x, s.player.z); }
  function sellPrice(item) { // 单价（浮动后，可为小数；结算时按总额取整）
    const supply = s.trade.supply[item] || 0;
    const f = Math.max(0.7, Math.min(1.3, 1.3 - supply * 0.02));
    return SELL_BASE[item] * f;
  }

  // 玩家站立高度（登上高塔时升高，供渲染层使用）
  function playerStandH() {
    const bid = occ[idx(Math.round(s.player.x), Math.round(s.player.z))];
    if (bid) {
      const b = s.buildings.find(bb => bb.id === bid);
      if (b && b.type === 'tower' && b.stage === 'done') return groundH(s.player.x, s.player.z) + 3.4;
    }
    return groundH(s.player.x, s.player.z);
  }

  return {
    world, state: s, step,
    groundH, canPlace, sellPrice, inTradeSafe, playerStandH,
    nodeYield,
    serialize() { return JSON.stringify(s); },
    tDay() { return (s.tick * TICK_DT) % DAY_LEN; },
  };
}

export const RES_NAMES = { wood: '木材', stone: '石头', iron: '铁', copper: '铜', fruit: '水果', wheat: '小麦', meat: '肉', seed: '种子' };
export function loadSim(json) {
  const s = JSON.parse(json);
  if (s.version !== SAVE_VERSION) return null;
  return createSim(s.seed, s.player.kit, { x: s.player.x, z: s.player.z }, s);
}
