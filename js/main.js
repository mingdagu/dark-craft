// 入口：开始界面（继续/新世界/选址/职业）→ 固定步长主循环 → 自动存档
import { createSim, loadSim, TICK_DT, KITS } from './sim/sim.js';
import { generateWorld, SIZE } from './sim/world.js';
import { createScene, buildMinimap } from './render/scene.js';
import { createHud } from './render/hud.js';
import { createInput } from './input/input.js';
import { Ambient, Music, AudioCore, playEventSfx } from './audio.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'dc_save';

// ---------- 音频控件 ----------
(function bindAudioCtl() {
  const muteBtn = $('muteBtn'), volM = $('volMusic'), volS = $('volSfx');
  const paint = () => { muteBtn.textContent = AudioCore.settings.mute ? '🔇' : '🔊'; };
  volM.value = AudioCore.settings.music; volS.value = AudioCore.settings.sfx; paint();
  muteBtn.addEventListener('click', () => { AudioCore.set('mute', !AudioCore.settings.mute); paint(); });
  volM.addEventListener('input', () => AudioCore.set('music', parseFloat(volM.value)));
  volS.addEventListener('input', () => AudioCore.set('sfx', parseFloat(volS.value)));
})();

// ---------- 开始界面 ----------
(function menu() {
  const saved = localStorage.getItem(SAVE_KEY);
  if (saved) $('btnContinue').style.display = 'inline-block';
  $('btnContinue').addEventListener('click', () => {
    const sim = loadSim(localStorage.getItem(SAVE_KEY));
    if (!sim) { alert('存档版本不兼容，请开新世界'); $('btnContinue').style.display = 'none'; return; }
    startGame(sim);
  });

  let seed = 0, preview = null, spawn = null, kit = 'farm';
  const cv = $('spawnMap'), ctx2 = cv.getContext('2d');
  function reroll() {
    seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    preview = generateWorld(seed);
    spawn = null;
    paintMap();
    $('spawnInfo').textContent = '种子 ' + seed + ' —— 点击地图选择你的家园';
    $('btnStart').disabled = true;
  }
  function paintMap() {
    ctx2.imageSmoothingEnabled = false;
    ctx2.drawImage(buildMinimap(preview), 0, 0, cv.width, cv.height);
    if (spawn) {
      const k = cv.width / SIZE;
      ctx2.strokeStyle = '#fff'; ctx2.lineWidth = 2;
      ctx2.beginPath(); ctx2.arc(spawn.x * k, spawn.z * k, 7, 0, 7); ctx2.stroke();
    }
  }
  $('btnNew').addEventListener('click', () => { $('menuBtns').style.display = 'none'; $('newPanel').style.display = 'block'; reroll(); });
  $('btnReroll').addEventListener('click', reroll);
  cv.addEventListener('click', e => {
    const r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * SIZE);
    const z = Math.floor((e.clientY - r.top) / r.height * SIZE);
    const i = z * SIZE + x;
    const bad =
      x < 3 || z < 3 || x > SIZE - 4 || z > SIZE - 4 ? '太靠近世界边缘' :
      preview.water[i] ? '不能把家安在水里' :
      preview.biome[i] === 2 ? '高山上无法安家' :
      preview.height[i] > 7 ? '地势太高' :
      preview.tradePosts.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < 121) ? '贸易站中立区不可安家' : null;
    if (bad) { $('spawnInfo').textContent = '⚠ ' + bad; return; }
    spawn = { x: x + 0.5, z: z + 0.5 };
    $('spawnInfo').textContent = '家园已选定 (' + x + ', ' + z + ')，选择你的初始生产资料后进入世界';
    $('btnStart').disabled = false;
    paintMap();
  });
  for (const btn of document.querySelectorAll('.kitBtn')) {
    btn.addEventListener('click', () => {
      kit = btn.dataset.kit;
      document.querySelectorAll('.kitBtn').forEach(b => b.classList.toggle('selected', b === btn));
    });
  }
  document.querySelector('.kitBtn[data-kit="farm"]').classList.add('selected');
  $('btnStart').addEventListener('click', () => {
    if (!spawn) return;
    startGame(createSim(seed, kit, spawn));
  });
})();

// ---------- 游戏主体 ----------
function startGame(sim) {
  $('startScreen').style.display = 'none';
  document.querySelectorAll('.gameUI').forEach(el => el.style.display = '');

  const scene = createScene(sim.world, sim);
  document.body.insertBefore(scene.renderer.domElement, document.body.firstChild);

  const extraActions = [];
  const handlers = {
    selectBlueprint(key) {
      hud.setSelected(hud.getSelected() === key ? null : key);
      hud.setDemolish(false);
      if (!hud.getSelected()) scene.clearGhost();
    },
    action(act) { extraActions.push(act); },
  };
  const hud = createHud(sim, scene, handlers);
  const input = createInput(sim, scene, hud);

  const save = () => { try { localStorage.setItem(SAVE_KEY, sim.serialize()); } catch (e) {} };
  setInterval(save, 30000);
  addEventListener('beforeunload', save);

  window.DC = { sim, version: 'M1' }; // 官方调试/测试句柄

  let last = performance.now(), acc = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dtReal = Math.min((now - last) / 1000, 0.25);
    last = now;
    acc += dtReal;
    let steps = 0;
    while (acc >= TICK_DT && steps < 5) {
      const inp = input.collect();
      inp.actions.push(...extraActions.splice(0));
      const events = sim.step(inp);
      for (const ev of events) {
        playEventSfx(ev);
        if (ev.t === 'autosave') save();
      }
      scene.applyEvents(events);
      hud.applyEvents(events);
      acc -= TICK_DT; steps++;
    }
    if (steps === 5) acc = 0; // 防失速螺旋
    const dark = scene.frame(dtReal);
    Ambient.update(dtReal, dark);
    Music.update(dark);
    hud.update(dtReal);
  }
  requestAnimationFrame(loop);
}
