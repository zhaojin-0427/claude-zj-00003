/* =========================================================
 * 工具函数
 * ========================================================= */

function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// 舱位命名：A1..A5 / B1..B5 ...
function bayName(i, cols) {
  return String.fromCharCode(65 + Math.floor(i / cols)) + (i % cols + 1);
}

function weightOf(c) { return CARGO_TYPES[c.type].weight * c.units; }
function bayWeight(bay) { return bay.containers.reduce((s, c) => s + weightOf(c), 0); }
function cargoName(c) { return CARGO_TYPES[c.type].name + (c.units > 1 ? '×' + c.units : ''); }
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// 文本内容变化时才更新，避免每帧重绘文字纹理
function setTxt(obj, s) { if (obj.__last !== s) { obj.__last = s; obj.setText(s); } }

// 文本样式快捷构造
function TS(size, color, extra) {
  return Object.assign({ fontSize: size, color: color, fontFamily: FONT_FAMILY }, extra || {});
}

/* ---------- localStorage ---------- */
function loadBest() {
  try { return JSON.parse(localStorage.getItem(LS_BEST)) || {}; } catch (e) { return {}; }
}
function saveBest(b) {
  try { localStorage.setItem(LS_BEST, JSON.stringify(b)); } catch (e) { /* 隐私模式下静默失败 */ }
}

// 合同模式：各航线最佳合同收益
function loadBestContracts() {
  try { return JSON.parse(localStorage.getItem(LS_BEST_CONTRACT)) || {}; } catch (e) { return {}; }
}
function saveBestContracts(b) {
  try { localStorage.setItem(LS_BEST_CONTRACT, JSON.stringify(b)); } catch (e) { /* ignore */ }
}

// 合同模式：最近一次未结束进度（按航线 key 存储）
function loadContractSaves() {
  try { return JSON.parse(localStorage.getItem(LS_CONTRACT_SAVE)) || {}; } catch (e) { return {}; }
}
function loadContractSave(key) {
  const all = loadContractSaves();
  return all[key] || null;
}
function saveContractRun(key, data) {
  try {
    const all = loadContractSaves();
    if (data) all[key] = data; else delete all[key];
    localStorage.setItem(LS_CONTRACT_SAVE, JSON.stringify(all));
  } catch (e) { /* ignore */ }
}
function clearContractRun(key) {
  try {
    const all = loadContractSaves();
    delete all[key];
    localStorage.setItem(LS_CONTRACT_SAVE, JSON.stringify(all));
  } catch (e) { /* ignore */ }
}

/* ---------- 合同与市场工具 ---------- */

// 合同货物组合描述：矿×2 能×1
function comboText(req) {
  return CARGO_KEYS.filter(k => req[k] > 0)
    .map(k => CARGO_TYPES[k].short + '×' + req[k]).join(' ');
}

// 一份合同完成后的基础货物价值（按基准价）
function contractBaseValue(req) {
  return CARGO_KEYS.reduce((s, k) => s + req[k] * MARKET.base[k], 0);
}

// 生成指定总件数/种类数的货物组合（结构同 genRequirements）
function genCargoCombo(unitsRange, typesRange) {
  const total = randInt(unitsRange[0], unitsRange[1]);
  const nT = Math.min(3, randInt(typesRange[0], typesRange[1]));
  const keys = Phaser.Utils.Array.Shuffle([...CARGO_KEYS]).slice(0, nT);
  const req = { ore: 0, energy: 0, supply: 0 };
  let left = total;
  keys.forEach((k, i) => {
    const slotsLeft = keys.length - i - 1;
    const maxV = Math.min(3, left - slotsLeft);
    const v = (i === keys.length - 1) ? left : randInt(1, Math.max(1, maxV));
    req[k] = v;
    left -= v;
  });
  return req;
}

/* ---------- Phaser 通用构件 ---------- */

// 星空背景
function drawStars(scene) {
  const w = scene.scale.width, h = scene.scale.height;
  const neb = scene.add.graphics();
  neb.fillStyle(0x1b2a4a, 0.30); neb.fillCircle(w * 0.18, h * 0.28, 190);
  neb.fillStyle(0x3a1b4a, 0.22); neb.fillCircle(w * 0.86, h * 0.72, 230);
  neb.fillStyle(0x0e3a3a, 0.18); neb.fillCircle(w * 0.55, h * 0.9, 160);
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const r = Math.random() < 0.85 ? 1 : 2;
    const star = scene.add.rectangle(x, y, r, r, 0xffffff, rand(0.25, 0.9));
    if (Math.random() < 0.18) {
      scene.tweens.add({ targets: star, alpha: rand(0.1, 0.4), duration: rand(900, 2400), yoyo: true, repeat: -1 });
    }
  }
}

// 通用按钮（居中对齐），返回带 setLabel 的 Container
function makeButton(scene, x, y, w, h, label, cb, opts) {
  opts = opts || {};
  const bgColor = opts.bg != null ? opts.bg : 0x1b2f44;
  const c = scene.add.container(x, y);
  const bg = scene.add.rectangle(0, 0, w, h, bgColor).setStrokeStyle(1, opts.stroke != null ? opts.stroke : 0x3d5a76);
  const t = scene.add.text(0, 0, label, TS(opts.fontSize || 14, opts.color || '#cfe6f5')).setOrigin(0.5);
  c.add([bg, t]);
  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerover', () => bg.setFillStyle(opts.hover != null ? opts.hover : 0x27445f));
  bg.on('pointerout', () => bg.setFillStyle(bgColor));
  bg.on('pointerdown', () => { if (Sfx) Sfx.click(); cb(); });
  c.setLabel = (s) => t.setText(s);
  return c;
}
