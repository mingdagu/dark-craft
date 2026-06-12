// HUD：四区极简界面（①资源 ②战斗状态与装备 ③建筑列表 ④城主功能=M2+）
// 只读模拟状态 + 接收用户点击转为回调，不直接改模拟。
import { BLUEPRINTS, SELL_BASE, BUY_PRICE, RES_NAMES, DAY_LEN, DAY_PART } from '../sim/sim.js';

const $ = id => document.getElementById(id);
const RAR_COLORS = ['#c8c8c8', '#5b8cff', '#ffd24a', '#ff8c2e'];
const RES_ORDER = ['wood', 'stone', 'iron', 'copper', 'fruit', 'wheat', 'meat', 'seed'];

export function createHud(sim, sceneApi, handlers) {
  const ui = {
    hpFill: $('hpFill'), mpFill: $('mpFill'), xpFill: $('xpFill'), hungerFill: $('hungerFill'),
    hpLabel: $('hpLabel'), mpLabel: $('mpLabel'), hungerLabel: $('hungerLabel'),
    lvl: $('lvlBadge'), pot: $('potText'), kill: $('killText'), money: $('moneyText'),
    wep: $('wepText'), arm: $('armText'),
    dayNum: $('dayNum'), dayIcon: $('dayIcon'), dayRing: $('dayRing'),
    res: $('resList'), buildBar: $('buildBar'), hint: $('hintBar'),
    trade: $('tradePanel'), tradeRows: $('tradeRows'),
    minimapBox: $('minimapBox'), minimapCv: $('minimapCanvas'),
    death: $('deathOverlay'), deathInfo: $('deathInfo'),
    toast: $('toast'),
  };
  const dmgTexts = [];
  let selected = null, demolish = false, minimapOpen = false, minimapBase = null;
  let toastT = 0;

  // ---------- 资源面板（第①区） ----------
  function renderRes() {
    const p = sim.state.player;
    let html = '<div class="resRow"><span class="resIcon" style="color:#ffd24a">⬤</span>金钱 <b>' + p.money + '</b></div>';
    for (const k of RES_ORDER) {
      html += '<div class="resRow"><span class="resIcon">▣</span>' + RES_NAMES[k] + ' <b>' + (p.inv[k] || 0) + '</b></div>';
    }
    if (ui.res.innerHTML !== html) ui.res.innerHTML = html;
  }

  // ---------- 建筑列表（第③区） ----------
  function renderBuildBar() {
    if (ui.buildBar.childElementCount === 0) {
      for (const key in BLUEPRINTS) {
        const bp = BLUEPRINTS[key];
        const btn = document.createElement('button');
        btn.className = 'bpBtn'; btn.dataset.bp = key;
        const cost = Object.entries(bp.cost).map(([k, v]) => v + RES_NAMES[k]).join(' ');
        btn.innerHTML = bp.name + '<small>' + cost + '</small>';
        btn.addEventListener('click', e => { e.stopPropagation(); handlers.selectBlueprint(key); });
        ui.buildBar.appendChild(btn);
      }
    }
    const p = sim.state.player;
    for (const btn of ui.buildBar.children) {
      const bp = BLUEPRINTS[btn.dataset.bp];
      const afford = Object.entries(bp.cost).every(([k, v]) => (p.inv[k] || 0) >= v);
      btn.classList.toggle('selected', selected === btn.dataset.bp);
      btn.classList.toggle('poor', !afford);
    }
  }

  // ---------- 贸易面板 ----------
  function renderTrade() {
    const inSafe = sim.inTradeSafe(sim.state.player.x, sim.state.player.z);
    ui.trade.style.display = inSafe ? 'block' : 'none';
    if (!inSafe) return;
    const p = sim.state.player;
    let html = '<div class="tradeHead">贸易站（中立安全区）</div>';
    for (const item in SELL_BASE) {
      const owned = p.inv[item] || 0;
      const price = sim.sellPrice(item);
      html += '<div class="tRow"><span>' + RES_NAMES[item] + ' ×' + owned + '</span>'
        + '<span class="tPrice">' + price.toFixed(1) + '金</span>'
        + '<button data-act="sell" data-item="' + item + '" data-qty="1" ' + (owned ? '' : 'disabled') + '>卖1</button>'
        + '<button data-act="sell" data-item="' + item + '" data-qty="999" ' + (owned ? '' : 'disabled') + '>全卖</button></div>';
    }
    html += '<div class="tradeHead" style="margin-top:6px">购买</div>';
    for (const item in BUY_PRICE) {
      const name = item === 'seed' ? '种子' : '生命药水';
      html += '<div class="tRow"><span>' + name + '</span><span class="tPrice">' + BUY_PRICE[item] + '金</span>'
        + '<button data-act="buy" data-item="' + item + '" ' + (sim.state.player.money >= BUY_PRICE[item] ? '' : 'disabled') + '>买1</button></div>';
    }
    if (ui.tradeRows.innerHTML !== html) ui.tradeRows.innerHTML = html;
  }
  ui.trade.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.act === 'sell') handlers.action({ a: 'sell', item: b.dataset.item, qty: parseInt(b.dataset.qty) });
    else handlers.action({ a: 'buy', item: b.dataset.item });
  });

  // ---------- 小地图 ----------
  function toggleMinimap() {
    minimapOpen = !minimapOpen;
    ui.minimapBox.style.display = minimapOpen ? 'block' : 'none';
    if (minimapOpen && !minimapBase) minimapBase = sceneApi.buildMinimapCanvas();
  }
  function drawMinimap() {
    if (!minimapOpen || !minimapBase) return;
    const cv = ui.minimapCv, ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(minimapBase, 0, 0, cv.width, cv.height);
    const k = cv.width / sim.world.size;
    const p = sim.state.player;
    if (p.home) { ctx.fillStyle = '#6ee87a'; ctx.fillRect(p.home.x * k - 3, p.home.z * k - 3, 6, 6); }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(p.x * k, p.z * k, 4, 0, 7); ctx.fill();
    for (const zb of sim.state.zombies) { ctx.fillStyle = '#cc3333'; ctx.fillRect(zb.x * k - 1.5, zb.z * k - 1.5, 3, 3); }
  }

  // ---------- 伤害飘字与提示 ----------
  function showText(x, z, text, color, size) {
    if (dmgTexts.length > 40) { dmgTexts.shift().el.remove(); }
    const el = document.createElement('div');
    el.className = 'dmgText'; el.textContent = text;
    el.style.color = color; el.style.fontSize = (size || 14) + 'px';
    document.body.appendChild(el);
    dmgTexts.push({ el, x, z, y: sim.groundH(x, z) + 2.2, life: 1.0 });
  }
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.style.opacity = 1;
    toastT = 2.5;
  }

  function applyEvents(events) {
    for (const ev of events) {
      if (ev.t === 'text') showText(ev.x, ev.z, ev.text, ev.color, ev.size);
      else if (ev.t === 'flash') { $('hitFlash').style.opacity = 0.8; }
      else if (ev.t === 'death') {
        ui.death.style.display = 'block';
        ui.deathInfo.textContent = sim.state.player.home ? '背包物资散落原地，黎明前可回去拾回。即将在家中醒来…' : '背包物资散落原地。即将在出生点醒来…';
      }
      else if (ev.t === 'respawn') ui.death.style.display = 'none';
      else if (ev.t === 'day') toast('第 ' + ev.day + ' 天开始了，进度已自动保存');
    }
  }

  function update(dtReal) {
    const p = sim.state.player;
    ui.hpFill.style.width = (p.hp / p.maxHp * 100) + '%';
    ui.mpFill.style.width = (p.mp / p.maxMp * 100) + '%';
    ui.xpFill.style.width = (p.xp / p.xpNeed * 100) + '%';
    ui.hungerFill.style.width = p.hunger + '%';
    ui.hpLabel.textContent = Math.ceil(p.hp) + ' / ' + p.maxHp;
    ui.mpLabel.textContent = Math.floor(p.mp) + ' / ' + p.maxMp;
    ui.hungerLabel.textContent = '饱食 ' + Math.ceil(p.hunger);
    ui.lvl.textContent = p.level;
    ui.pot.textContent = p.potions;
    ui.kill.textContent = p.kills;
    ui.money.textContent = p.money;
    if (p.weapon) { ui.wep.textContent = p.weapon.name + ' 攻击+' + p.weapon.power; ui.wep.style.color = RAR_COLORS[p.weapon.rarity]; }
    else { ui.wep.textContent = '赤手空拳'; ui.wep.style.color = '#888'; }
    if (p.armor) { ui.arm.textContent = p.armor.name + ' 防御+' + p.armor.power; ui.arm.style.color = RAR_COLORS[p.armor.rarity]; }
    else { ui.arm.textContent = '破布衣衫'; ui.arm.style.color = '#888'; }

    const tDay = sim.tDay();
    ui.dayNum.textContent = '第 ' + sim.state.day + ' 天';
    ui.dayIcon.textContent = tDay < DAY_PART ? '☀' : '🌙';
    ui.dayRing.style.background = 'conic-gradient(#c9a227 ' + (tDay / DAY_LEN * 360).toFixed(1) + 'deg, #2a2f3a 0deg)';

    renderRes(); renderBuildBar(); renderTrade(); drawMinimap();

    // 飘字
    for (let i = dmgTexts.length - 1; i >= 0; i--) {
      const d = dmgTexts[i];
      d.life -= dtReal; d.y += dtReal * 1.6;
      if (d.life <= 0) { d.el.remove(); dmgTexts.splice(i, 1); continue; }
      const s = sceneApi.worldToScreen(d.x, d.y, d.z);
      d.el.style.left = s.sx + 'px'; d.el.style.top = s.sy + 'px';
      d.el.style.opacity = Math.min(1, d.life * 2);
    }
    const hf = $('hitFlash');
    if (parseFloat(hf.style.opacity) > 0) hf.style.opacity = Math.max(0, parseFloat(hf.style.opacity) - dtReal * 2);
    if (toastT > 0) { toastT -= dtReal; if (toastT <= 0) ui.toast.style.opacity = 0; }

    // 提示栏
    let hint = '';
    if (selected) hint = '建造模式：' + BLUEPRINTS[selected].name + ' —— 左键放置工地，Esc/右键取消；走近工地按住左键施工';
    else if (demolish) hint = '拆除模式：点击自己的建筑拆除（返还半数材料），Esc 取消';
    else if (p.level < 3) hint = 'WASD移动 · 左键攻击/采集/施工 · F进食 · Q药水 · B建造 · E开关门 · M地图';
    ui.hint.textContent = hint;
  }

  return {
    update, applyEvents, toast, toggleMinimap,
    setSelected(bp) { selected = bp; },
    getSelected() { return selected; },
    setDemolish(v) { demolish = v; },
    getDemolish() { return demolish; },
  };
}
