// 输入层：键鼠 → 每 tick 一份可序列化指令（联机三纪律之指令化）
import { BLUEPRINTS } from '../sim/sim.js';

export function createInput(sim, sceneApi, hud) {
  const keys = {};
  const ndc = { x: 0, y: 0 };
  let lmb = false, rmb = false;
  const actions = [];
  let aim = null;

  const uiClick = e => e.target.closest && e.target.closest('#buildBar, #tradePanel, #audioCtl, #deathOverlay, #minimapBox, #startScreen, #muteBtn');

  addEventListener('keydown', e => {
    if (e.code === 'Space') e.preventDefault();
    if (keys[e.code]) return;
    keys[e.code] = true;
    if (document.getElementById('startScreen').style.display !== 'none') return;
    switch (e.code) {
      case 'KeyQ': actions.push({ a: 'potion' }); break;
      case 'KeyF': actions.push({ a: 'eat' }); break;
      case 'KeyM': hud.toggleMinimap(); break;
      case 'KeyB': {
        const cur = hud.getSelected();
        hud.setSelected(cur ? null : 'house');
        if (!cur) hud.setDemolish(false); else sceneApi.clearGhost();
        break;
      }
      case 'KeyX': {
        hud.setDemolish(!hud.getDemolish());
        hud.setSelected(null); sceneApi.clearGhost();
        break;
      }
      case 'KeyE': {
        // 最近的城门
        const p = sim.state.player;
        let best = null, bd = 16;
        for (const b of sim.state.buildings) {
          if (b.stage !== 'done' || !BLUEPRINTS[b.type].gate) continue;
          const d = (b.x - p.x) ** 2 + (b.z - p.z) ** 2;
          if (d < bd) { bd = d; best = b; }
        }
        if (best) actions.push({ a: 'toggleGate', id: best.id });
        break;
      }
      case 'Escape': {
        hud.setSelected(null); hud.setDemolish(false); sceneApi.clearGhost();
        break;
      }
    }
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('mousemove', e => {
    ndc.x = (e.clientX / innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / innerHeight) * 2 + 1;
  });
  addEventListener('mousedown', e => {
    if (uiClick(e)) return;
    if (document.getElementById('startScreen').style.display !== 'none') return;
    if (e.button === 0) {
      const sel = hud.getSelected();
      if (sel && aim) {
        actions.push({ a: 'place', type: sel, x: Math.round(aim.x), z: Math.round(aim.z) });
        return; // 保持建造模式可连续放置
      }
      if (hud.getDemolish() && aim) {
        const ax = Math.round(aim.x), az = Math.round(aim.z);
        const b = sim.state.buildings.find(bb => {
          const bp = BLUEPRINTS[bb.type];
          return ax >= bb.x && ax < bb.x + bp.w && az >= bb.z && az < bb.z + bp.d;
        });
        if (b) actions.push({ a: 'demolish', id: b.id });
        return;
      }
      lmb = true;
    }
    if (e.button === 2) {
      if (hud.getSelected() || hud.getDemolish()) {
        hud.setSelected(null); hud.setDemolish(false); sceneApi.clearGhost();
      } else rmb = true;
    }
  });
  addEventListener('mouseup', e => {
    if (e.button === 0) lmb = false;
    if (e.button === 2) rmb = false;
  });
  addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('blur', () => { lmb = false; rmb = false; for (const k in keys) keys[k] = false; });

  function collect() {
    aim = sceneApi.aimPoint(ndc);
    const p = sim.state.player;
    let facing = p.facing;
    if (aim) facing = Math.atan2(aim.x - p.x, aim.z - p.z);
    // 建造幽灵
    const sel = hud.getSelected();
    if (sel && aim) {
      const gx = Math.round(aim.x), gz = Math.round(aim.z);
      sceneApi.setGhost(sel, gx, gz, sim.canPlace(sel, gx, gz).ok);
    } else if (!sel) sceneApi.clearGhost();
    let mx = 0, mz = 0;
    if (keys['KeyW']) { mx -= 1; mz -= 1; }
    if (keys['KeyS']) { mx += 1; mz += 1; }
    if (keys['KeyA']) { mx -= 1; mz += 1; }
    if (keys['KeyD']) { mx += 1; mz -= 1; }
    const out = {
      move: { x: mx, z: mz }, facing, aim,
      work: lmb && !sel && !hud.getDemolish(),
      fire: rmb || !!keys['Space'],
      actions: actions.splice(0),
    };
    return out;
  }
  return { collect };
}
