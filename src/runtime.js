const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function fitCanvasToCSS(canvas, maxDpr = 2) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, dpr };
}

function rng(seed) {
  // mulberry32
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function makeMaze(w, h, seed = Date.now()) {
  const R = rng(seed);
  // 1 = wall, 0 = floor
  const grid = Array.from({ length: h }, () => Array.from({ length: w }, () => 1));

  // start at odd cell
  const sx = 1;
  const sy = 1;
  grid[sy][sx] = 0;

  const stack = [{ x: sx, y: sy }];
  const dirs = [
    { x: 0, y: -2 },
    { x: 0, y: 2 },
    { x: -2, y: 0 },
    { x: 2, y: 0 },
  ];

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const candidates = [];
    for (const d of dirs) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (nx <= 0 || ny <= 0 || nx >= w - 1 || ny >= h - 1) continue;
      if (grid[ny][nx] === 1) candidates.push({ nx, ny, wx: cur.x + d.x / 2, wy: cur.y + d.y / 2 });
    }

    if (candidates.length === 0) {
      stack.pop();
      continue;
    }

    const pick = candidates[Math.floor(R() * candidates.length)];
    grid[pick.wy][pick.wx] = 0;
    grid[pick.ny][pick.nx] = 0;
    stack.push({ x: pick.nx, y: pick.ny });
  }

  // add some loops by knocking down random walls
  for (let i = 0; i < (w * h) * 0.02; i++) {
    const x = 1 + Math.floor(R() * (w - 2));
    const y = 1 + Math.floor(R() * (h - 2));
    if (grid[y][x] === 1) {
      // ensure it connects two floors
      const n = (grid[y - 1][x] === 0) + (grid[y + 1][x] === 0) + (grid[y][x - 1] === 0) + (grid[y][x + 1] === 0);
      if (n >= 2) grid[y][x] = 0;
    }
  }

  return { grid, seed };
}

function findRandomFloor(grid, R) {
  const h = grid.length;
  const w = grid[0].length;
  for (let tries = 0; tries < 10000; tries++) {
    const x = 1 + Math.floor(R() * (w - 2));
    const y = 1 + Math.floor(R() * (h - 2));
    if (grid[y][x] === 0) return { x, y };
  }
  return { x: 1, y: 1 };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class Game {
  constructor({ canvas, ui }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ui = ui;

    this.running = false;
    this.paused = false;

    this.world = { w: 1, h: 1, dpr: 1 };

    this.mapW = 31; // odd
    this.mapH = 31; // odd

    this.seed = 0;
    this.R = rng(1);

    this.grid = [];

    this.player = { x: 1.5, y: 1.5, a: 0, vx: 0, vy: 0, speed: 3.4 };
    this.move = { x: 0, y: 0 };

    this.keys = 0;
    this.keyPos = [];
    this.exitPos = null;

    this.enemy = { x: 2.5, y: 2.5, state: 'wander', a: 0, speed: 1.7, lastSeen: 0 };

    this.fov = Math.PI / 3;

    this.lastT = 0;

    this.resize();
    this.loop = this.loop.bind(this);
  }

  resize() {
    this.world = fitCanvasToCSS(this.canvas);
  }

  setMove(vx, vy) {
    this.move.x = vx;
    this.move.y = vy;
  }

  addLook(dx) {
    if (!this.running || this.paused) return;
    this.player.a += dx * 0.0045;
  }

  startNew() {
    this.running = true;
    this.paused = false;

    const { grid, seed } = makeMaze(this.mapW, this.mapH, Date.now());
    this.grid = grid;
    this.seed = seed;
    this.R = rng(seed);

    // place player
    const p = findRandomFloor(this.grid, this.R);
    this.player.x = p.x + 0.5;
    this.player.y = p.y + 0.5;
    this.player.a = this.R() * Math.PI * 2;

    // place keys far enough
    this.keys = 0;
    this.keyPos = [];
    while (this.keyPos.length < 3) {
      const k = findRandomFloor(this.grid, this.R);
      if (dist({ x: k.x + 0.5, y: k.y + 0.5 }, this.player) < 8) continue;
      if (this.keyPos.some(o => o.x === k.x && o.y === k.y)) continue;
      this.keyPos.push(k);
    }

    // place exit far enough
    while (true) {
      const e = findRandomFloor(this.grid, this.R);
      if (dist({ x: e.x + 0.5, y: e.y + 0.5 }, this.player) < 10) continue;
      if (this.keyPos.some(o => o.x === e.x && o.y === e.y)) continue;
      this.exitPos = e;
      break;
    }

    // place enemy: not too far so it shows up during short playtests
    // (aim: 6〜10 tiles away)
    let en = null;
    for (let tries = 0; tries < 8000; tries++) {
      const cand = findRandomFloor(this.grid, this.R);
      const cpos = { x: cand.x + 0.5, y: cand.y + 0.5 };
      const d = dist(cpos, this.player);
      if (d < 6 || d > 10) continue;
      en = cand;
      break;
    }
    if (!en) en = findRandomFloor(this.grid, this.R);

    this.enemy.x = en.x + 0.5;
    this.enemy.y = en.y + 0.5;
    this.enemy.state = 'wander';
    this.enemy.a = this.R() * Math.PI * 2;
    this.enemy.lastSeen = 0;

    this.ui.keys.textContent = String(this.keys);
    this.ui.status.textContent = 'Find keys';

    this.ui.btnStart && (this.ui.btnStart.style.display = 'none');
    this.ui.btnRestart && (this.ui.btnRestart.style.display = 'none');

    this.lastT = performance.now();
    requestAnimationFrame(this.loop);
  }

  togglePause() {
    this.paused = !this.paused;
    if (!this.paused) {
      this.lastT = performance.now();
      requestAnimationFrame(this.loop);
    }
  }

  win() {
    this.running = false;
    this.ui.title.textContent = 'Clear!';
    this.ui.desc.textContent = `You escaped. (seed: ${this.seed})`;
    this.ui.btnRestart.style.display = 'inline-block';
    this.ui.overlay.style.display = 'flex';
  }

  gameOver() {
    this.running = false;
    this.ui.title.textContent = 'Game Over';
    this.ui.desc.textContent = `Caught... (seed: ${this.seed})`;
    this.ui.btnRestart.style.display = 'inline-block';
    this.ui.overlay.style.display = 'flex';
  }

  isWall(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (yi < 0 || yi >= this.grid.length) return true;
    if (xi < 0 || xi >= this.grid[0].length) return true;
    return this.grid[yi][xi] === 1;
  }

  canStand(nx, ny) {
    const r = 0.14;
    return (!this.isWall(nx + r, ny) && !this.isWall(nx - r, ny) && !this.isWall(nx, ny + r) && !this.isWall(nx, ny - r));
  }

  tryMove(actor, nx, ny) {
    // axis-separated move so you slide along walls instead of getting stuck
    if (this.canStand(nx, actor.y)) actor.x = nx;
    if (this.canStand(actor.x, ny)) actor.y = ny;
  }

  pickup() {
    const px = Math.floor(this.player.x);
    const py = Math.floor(this.player.y);

    // keys
    for (let i = 0; i < this.keyPos.length; i++) {
      const k = this.keyPos[i];
      if (k.x === px && k.y === py) {
        this.keyPos.splice(i, 1);
        this.keys += 1;
        this.ui.keys.textContent = String(this.keys);
        this.ui.status.textContent = this.keys >= 3 ? 'Go to EXIT' : 'Find keys';
        break;
      }
    }

    // exit
    if (this.exitPos && this.exitPos.x === px && this.exitPos.y === py) {
      if (this.keys >= 3) this.win();
      else this.ui.status.textContent = 'Need 3 keys';
    }
  }

  canSeePlayer(maxDist = 12.0) {
    // line of sight ray
    const dx = this.player.x - this.enemy.x;
    const dy = this.player.y - this.enemy.y;
    const d = Math.hypot(dx, dy);
    if (d > maxDist) return false;

    const steps = Math.ceil(d / 0.15);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = this.enemy.x + dx * t;
      const y = this.enemy.y + dy * t;
      if (this.isWall(x, y)) return false;
    }
    return true;
  }

  stepEnemy(dt, now) {
    // state machine
    const sees = this.canSeePlayer();
    if (sees) {
      this.enemy.state = 'chase';
      this.enemy.lastSeen = now;
      this.ui.status.textContent = 'RUN!';
    } else {
      if (this.enemy.state === 'chase' && (now - this.enemy.lastSeen) > 1.8) {
        this.enemy.state = 'wander';
        this.ui.status.textContent = this.keys >= 3 ? 'Go to EXIT' : 'Find keys';
      }
    }

    let targetA = this.enemy.a;
    if (this.enemy.state === 'chase') {
      targetA = Math.atan2(this.player.y - this.enemy.y, this.player.x - this.enemy.x);
    } else {
      // wander: sometimes turn
      if (this.R() < 0.02) {
        targetA += (this.R() - 0.5) * 1.3;
      }
      // avoid walls by probing
      const fx = this.enemy.x + Math.cos(targetA) * 0.35;
      const fy = this.enemy.y + Math.sin(targetA) * 0.35;
      if (this.isWall(fx, fy)) {
        targetA += (this.R() < 0.5 ? 1 : -1) * (0.8 + this.R());
      }
    }

    // smooth rotate
    const da = wrapAngle(targetA - this.enemy.a);
    this.enemy.a += da * clamp(dt * 4.0, 0, 1);

    const spd = (this.enemy.state === 'chase') ? 2.7 : this.enemy.speed;
    const nx = this.enemy.x + Math.cos(this.enemy.a) * spd * dt;
    const ny = this.enemy.y + Math.sin(this.enemy.a) * spd * dt;
    this.tryMove(this.enemy, nx, ny);

    // collision with player
    const d = Math.hypot(this.player.x - this.enemy.x, this.player.y - this.enemy.y);
    if (d < 0.35) this.gameOver();
  }

  step(dt, now) {
    // movement vector in camera space
    const ax = this.move.x;
    const ay = this.move.y;

    // deadzone（小さめにして前進しやすく）
    const dz = 0.06;
    const mx = Math.abs(ax) < dz ? 0 : ax;
    const my = Math.abs(ay) < dz ? 0 : ay;

    const ca = Math.cos(this.player.a);
    const sa = Math.sin(this.player.a);

    // joystick y is down; forward is -my
    const forward = -my;
    const strafe = mx;

    // stickの効きを少し強める（小さい入力でも進む）
    const boost = (v) => Math.sign(v) * Math.min(1, Math.abs(v) ** 0.75);
    const vx = (ca * boost(forward) - sa * boost(strafe)) * this.player.speed;
    const vy = (sa * boost(forward) + ca * boost(strafe)) * this.player.speed;

    const nx = this.player.x + vx * dt;
    const ny = this.player.y + vy * dt;
    this.tryMove(this.player, nx, ny);

    this.pickup();
    if (!this.running) return;

    this.stepEnemy(dt, now);
  }

  raycast(angle) {
    // DDA raycast
    const px = this.player.x;
    const py = this.player.y;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    let mapX = Math.floor(px);
    let mapY = Math.floor(py);

    const deltaDistX = Math.abs(1 / (dx || 1e-9));
    const deltaDistY = Math.abs(1 / (dy || 1e-9));

    let stepX, stepY;
    let sideDistX, sideDistY;

    if (dx < 0) { stepX = -1; sideDistX = (px - mapX) * deltaDistX; }
    else { stepX = 1; sideDistX = (mapX + 1.0 - px) * deltaDistX; }

    if (dy < 0) { stepY = -1; sideDistY = (py - mapY) * deltaDistY; }
    else { stepY = 1; sideDistY = (mapY + 1.0 - py) * deltaDistY; }

    let hit = 0;
    let side = 0;

    for (let i = 0; i < 128; i++) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }

      if (mapY < 0 || mapY >= this.grid.length || mapX < 0 || mapX >= this.grid[0].length) { hit = 1; break; }
      if (this.grid[mapY][mapX] === 1) { hit = 1; break; }
    }

    // distance to wall
    let perpWallDist;
    if (side === 0) perpWallDist = (sideDistX - deltaDistX);
    else perpWallDist = (sideDistY - deltaDistY);

    return { dist: perpWallDist, side, mapX, mapY };
  }

  draw() {
    const ctx = this.ctx;
    const { w, h, dpr } = this.world;

    // ceiling + floor (backrooms yellow-ish)
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1a2236';
    ctx.fillRect(0, 0, w, h * 0.5);
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, h * 0.5, w, h * 0.5);

    const numRays = Math.floor(w / 2); // fast
    const halfH = h * 0.5;

    // wall color
    for (let i = 0; i < numRays; i++) {
      const camX = (2 * i) / numRays - 1;
      const angle = this.player.a + Math.atan(camX * Math.tan(this.fov / 2));
      const r = this.raycast(angle);

      const dist = Math.max(0.0001, r.dist);
      const lineH = Math.min(h, (h / dist));
      const start = Math.floor(halfH - lineH / 2);
      const end = Math.floor(halfH + lineH / 2);

      // shade
      const base = r.side === 1 ? 0.75 : 1.0;
      const fog = clamp(1 - dist / 10, 0, 1);
      const y = Math.floor(210 * base * fog);
      const col = `rgb(${y}, ${y}, ${Math.floor(y*0.7)})`;

      ctx.fillStyle = col;
      const x = Math.floor((i / numRays) * w);
      const ww = Math.ceil(w / numRays) + 1;
      ctx.fillRect(x, start, ww, end - start);
    }

    // draw key/exit/enemy as sprites in pseudo-3D (billboards)
    this.drawBillboards();

    // crosshair
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2*dpr;
    ctx.beginPath();
    ctx.moveTo(w/2 - 10*dpr, h/2);
    ctx.lineTo(w/2 + 10*dpr, h/2);
    ctx.moveTo(w/2, h/2 - 10*dpr);
    ctx.lineTo(w/2, h/2 + 10*dpr);
    ctx.stroke();

    // danger overlay when enemy close
    const dd = Math.hypot(this.player.x - this.enemy.x, this.player.y - this.enemy.y);
    const danger = clamp(1 - dd / 7.5, 0, 1);
    if (danger > 0) {
      // red pulse
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
      ctx.fillStyle = `rgba(255,77,109,${(0.12 + 0.18 * pulse) * danger})`;
      ctx.fillRect(0, 0, w, h);

      // static noise
      ctx.globalAlpha = 0.10 * danger;
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 90; i++) {
        const x = (i * 97 + (performance.now() * 0.6)) % w;
        const y = (i * 211 + (performance.now() * 0.4)) % h;
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  drawBillboards() {
    const ctx = this.ctx;
    const { w, h } = this.world;

    const ents = [];

    // keys as green squares
    for (const k of this.keyPos) {
      ents.push({ kind: 'key', x: k.x + 0.5, y: k.y + 0.5, color: '#2ee59d' });
    }

    // exit
    if (this.exitPos) {
      ents.push({ kind: 'exit', x: this.exitPos.x + 0.5, y: this.exitPos.y + 0.5, color: this.keys >= 3 ? '#ffd166' : '#7c5cff' });
    }

    // enemy
    ents.push({ kind: 'enemy', x: this.enemy.x, y: this.enemy.y, color: '#ff4d6d' });

    // sort by distance far->near
    ents.sort((a, b) => (dist2(this.player, b) - dist2(this.player, a)));

    for (const e of ents) {
      const dx = e.x - this.player.x;
      const dy = e.y - this.player.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.4) continue;

      const ang = Math.atan2(dy, dx);
      const rel = wrapAngle(ang - this.player.a);
      if (Math.abs(rel) > this.fov * 0.55) continue;

      // project to screen
      const sx = (0.5 + (rel / this.fov)) * w;
      const size = clamp((h / d) * (e.kind === 'enemy' ? 0.26 : 0.18), 10, h * 0.45);
      const sy = h * 0.5;

      ctx.save();
      ctx.translate(sx, sy);

      if (e.kind === 'enemy') {
        ctx.fillStyle = e.color;
        ctx.globalAlpha = 0.92;
        roundedRect(ctx, -size*0.35, -size*0.55, size*0.7, size*1.1, size*0.18);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(-size*0.18, -size*0.18, size*0.12, size*0.10);
        ctx.fillRect(size*0.06, -size*0.18, size*0.12, size*0.10);
      } else if (e.kind === 'exit') {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = e.color;
        roundedRect(ctx, -size*0.30, -size*0.55, size*0.60, size*1.10, size*0.10);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(-size*0.10, 0, size*0.20, size*0.22);
      } else {
        // key
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.arc(0, 0, size*0.22, 0, Math.PI*2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = Math.max(2, size*0.06);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  loop(t) {
    if (!this.running || this.paused) return;
    const dt = clamp((t - this.lastT) / 1000, 0, 0.033);
    this.lastT = t;

    this.step(dt, t / 1000);
    if (!this.running) return;
    this.draw();
    requestAnimationFrame(this.loop);
  }
}

function wrapAngle(a) {
  while (a < -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx*dx + dy*dy;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
