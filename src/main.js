import { makeIcons } from './png.js';
import { Game } from './runtime.js';

const canvas = document.getElementById('game');
const ui = {
  overlay: document.getElementById('overlay'),
  title: document.getElementById('title'),
  desc: document.getElementById('desc'),
  btnStart: document.getElementById('btnStart'),
  btnRestart: document.getElementById('btnRestart'),
  btnPause: document.getElementById('btnPause'),
  keys: document.getElementById('keys'),
  status: document.getElementById('status'),
  stick: document.getElementById('stick'),
  knob: document.getElementById('knob'),
};

ui.overlay.style.display = 'flex';
ui.btnRestart.style.display = 'none';

// generate icons on first load if missing (noop on GH pages)
makeIcons().catch(()=>{});

const game = new Game({ canvas, ui });

ui.btnStart.addEventListener('click', () => {
  ui.overlay.style.display = 'none';
  game.startNew();
});

ui.btnRestart.addEventListener('click', () => {
  ui.overlay.style.display = 'none';
  game.startNew();
});

ui.btnPause.addEventListener('click', () => {
  if (!game.running) return;
  game.togglePause();
  ui.btnPause.textContent = game.paused ? 'Resume' : 'Pause';
});

bindJoystick(ui.stick, ui.knob, (vx, vy) => game.setMove(vx, vy));
bindLook(canvas, (dx) => game.addLook(dx));

window.addEventListener('resize', () => game.resize());

function bindJoystick(stick, knob, onMove) {
  const state = { active: false, id: null, cx: 0, cy: 0 };

  const setKnob = (dx, dy) => {
    const r = 54;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, len / r);
    const nx = (dx / len) * (k * r);
    const ny = (dy / len) * (k * r);
    knob.style.transform = `translate(${nx}px, ${ny}px)`;
    onMove(nx / r, ny / r);
  };

  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    state.active = true;
    state.id = e.pointerId;
    const r = stick.getBoundingClientRect();
    state.cx = r.left + r.width / 2;
    state.cy = r.top + r.height / 2;
    stick.setPointerCapture(e.pointerId);
    setKnob(e.clientX - state.cx, e.clientY - state.cy);
  }, { passive: false });

  stick.addEventListener('pointermove', (e) => {
    if (!state.active || e.pointerId !== state.id) return;
    e.preventDefault();
    setKnob(e.clientX - state.cx, e.clientY - state.cy);
  }, { passive: false });

  const end = (e) => {
    if (e.pointerId !== state.id) return;
    state.active = false;
    state.id = null;
    knob.style.transform = 'translate(0px, 0px)';
    onMove(0, 0);
  };

  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);
}

function bindLook(canvas, onDx) {
  const state = { active: false, id: null, lastX: 0 };
  canvas.addEventListener('pointerdown', (e) => {
    // only right half to avoid stick area
    const rect = canvas.getBoundingClientRect();
    if (e.clientX < rect.left + rect.width * 0.45) return;
    state.active = true;
    state.id = e.pointerId;
    state.lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!state.active || e.pointerId !== state.id) return;
    const dx = e.clientX - state.lastX;
    state.lastX = e.clientX;
    onDx(dx);
  });
  const end = (e) => {
    if (e.pointerId !== state.id) return;
    state.active = false;
    state.id = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}
