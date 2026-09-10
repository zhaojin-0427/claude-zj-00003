/* =========================================================
 * 游戏主场景：货运甲板调度
 *  - 卸货船卸货 / 装货船集货订单
 *  - 舱位堆叠与载重限制、燃料预算
 *  - 合并集装 / 拆分 / 优先直转
 *  - 氧气泄漏 / 货舱损坏 / 海盗袭击
 *  - 暂停规划 / 撤销 / 稳定度 / 高分
 * ========================================================= */
class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  init(data) {
    this.diffIndex = (data && data.difficulty != null) ? data.difficulty : 0;
    this.contractMode = !!(data && data.mode === 'contract');
    this.resumeKey = (data && data.resume) ? this.cfgKeyOf(data.difficulty) : null;
    this.freshContract = !!(data && data.fresh);
  }

  cfgKeyOf(idx) { return DIFFICULTIES[idx != null ? idx : this.diffIndex].key; }

  /* ================= 初始化 ================= */

  create() {
    this.cfg = DIFFICULTIES[this.diffIndex];
    if (this.contractMode && this.freshContract) clearContractRun(this.cfg.key);
    const st = this.state = {
      time: 0, score: 0,
      fuel: this.cfg.startFuel, stability: 80, oxygen: 100,
      paused: false, gameOver: false,
      leak: false, crisis: null,       // crisis: {type:'leak'|'pirate'|'damage', ...}
      bays: [], docks: [], queue: [],
    };
    for (let i = 0; i < this.cfg.bays; i++) st.bays.push({ containers: [], damagedUntil: 0 });
    for (let i = 0; i < this.cfg.docks; i++) st.docks.push(null);

    this.undoStack = [];
    this.selected = null;              // {kind:'bay'|'shipCargo'|'shipLoad', key, id}
    this.containerSeq = 1;
    this.shipSeq = 1;
    this.stats = { done: 0, unloaded: 0, missed: 0, stolen: 0, contractDone: 0, contractExpired: 0 };
    this.spawnTimer = 1.0;
    this.eventTimer = rand(this.cfg.eventInterval[0], this.cfg.eventInterval[1]);
    this.lastEvent = null;

    // ---- 合同模式状态 ----
    this.intro = false;
    this.contractSeq = 1;
    this.contracts = [];
    this.market = { prices: { ...MARKET.base }, timer: MARKET.interval, last: { ...MARKET.base } };
    this.earnings = { base: 0, market: 0, time: 0, fuel: 0 };
    this.saveTimer = 0;

    this.createTextures();
    drawStars(this);
    this.buildTopBar();
    this.buildDeck();
    this.buildDocks();
    this.buildRightPanels();
    this.buildBanner();
    this.buildActionBar();
    this.buildLogView();
    this.buildPauseOverlay();
    this.setupInput();

    if (this.contractMode && this.resumeKey && loadContractSave(this.resumeKey)) {
      // 恢复未结束合同局
      this.restoreRun(loadContractSave(this.resumeKey));
      this.resumeKey = null;
      this.addLog('📂 已恢复上次未结束的合同局', '#9dff9d');
    } else {
      if (this.contractMode) {
        // 合同接取前只安排卸货船，确保装货船在接取后生成、能匹配合同
        this.enqueueShip('unloader', 0.5);
        this.enqueueShip('unloader', 8);
      } else {
        // 初始船流
        this.enqueueShip('unloader', 0.5);
        this.enqueueShip('loader', 1.5);
        this.enqueueShip(null, 6);
        this.enqueueShip(null, 11);
      }
      if (this.contractMode) {
        // 弹出 3 份合同供接取（至多 2 份）
        this.intro = true;
        this.showContractOffer();
      }
    }

    this.addLog('🛰 空间站调度系统上线，开始作业', '#7fe3ff');
    if (!this.contractMode) this.addLog('点击货物选择，再点击舱位或船只放置', '#9fb7cc');
    this.renderAll();

    // 离开页面前自动保存合同局
    if (this.contractMode) {
      this._onHide = () => { if (!this.state.gameOver) this.saveRun(); };
      window.addEventListener('pagehide', this._onHide);
      this.events.once('shutdown', () => window.removeEventListener('pagehide', this._onHide));
    }
  }

  createTextures() {
    const make = (key, color) => {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(color, 1);
      g.fillRoundedRect(0, 6, 34, 16, 5);
      g.fillTriangle(34, 4, 34, 24, 48, 14);
      g.fillStyle(0xffffff, 0.85);
      g.fillCircle(10, 14, 3); g.fillCircle(20, 14, 3);
      g.generateTexture(key, 48, 28);
      g.destroy();
    };
    make('ship_in', 0x4fc3f7);
    make('ship_out', 0xffb74d);
  }

  /* ================= UI 构建 ================= */

  buildTopBar() {
    this.add.rectangle(0, 0, 1280, 54, 0x0b1622).setOrigin(0);
    this.add.rectangle(0, 53, 1280, 1, 0x1e3247).setOrigin(0);
    this.add.text(16, 8, `🛰 星际运输站 · ${this.cfg.name}${this.contractMode ? ' · 合同模式' : ''}`, TS(18, '#dff3ff', { fontStyle: 'bold' }));
    this.add.text(16, 33, `难度 ${this.cfg.stars} · 泊位 ${this.cfg.docks} · 舱位 ${this.cfg.bays}`, TS(11, '#6f8aa5'));

    const ui = this.ui = {};
    this.add.text(330, 10, '分数', TS(11, '#6f8aa5'));
    ui.scoreVal = this.add.text(330, 24, '0', TS(20, '#ffd24a', { fontStyle: 'bold' }));

    const mkBar = (x, label, color) => {
      this.add.text(x, 10, label, TS(11, '#6f8aa5'));
      this.add.rectangle(x, 36, 110, 10, 0x0b141d).setOrigin(0, 0.5);
      const fill = this.add.rectangle(x, 36, 110, 10, color).setOrigin(0, 0.5);
      const val = this.add.text(x + 116, 30, '', TS(12, '#cfe6f5'));
      return { fill, val };
    };
    const fb = mkBar(430, '燃料', 0x4fc3f7);   ui.fuelFill = fb.fill; ui.fuelVal = fb.val;
    const sb = mkBar(600, '稳定度', 0x7dd87d); ui.stabFill = sb.fill; ui.stabVal = sb.val;
    const ob = mkBar(770, '氧气', 0x9fd8ff);   ui.oxyFill = ob.fill;  ui.oxyVal = ob.val;

    ui.timeText = this.add.text(928, 20, '00:00', TS(16, '#9fb7cc'));
    ui.undoBtn  = makeButton(this, 1030, 27, 84, 26, '↩ 撤销', () => this.undo(), { fontSize: 13 });
    ui.pauseBtn = makeButton(this, 1122, 27, 76, 26, '⏸ 暂停', () => this.togglePause(), { fontSize: 13 });
    ui.menuBtn  = makeButton(this, 1206, 27, 76, 26, '菜单', () => {
      if (this.contractMode && !this.state.gameOver) this.saveRun();
      this.scene.start('MenuScene');
    }, { fontSize: 13 });
  }

  buildDeck() {
    const cfg = this.cfg, cols = cfg.bayCols, rows = Math.ceil(cfg.bays / cols);
    const gap = 10, areaX = 16, areaY = 76, areaW = 590;
    const bw = Math.floor((areaW - (cols - 1) * gap) / cols), bh = 150;
    this.add.text(16, 58, '货运甲板', TS(12, '#7d93a8'));
    this.bayViews = [];
    for (let i = 0; i < cfg.bays; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const x = areaX + c * (bw + gap), y = areaY + r * (bh + gap);
      const bg = this.add.rectangle(x, y, bw, bh, 0x14202e).setOrigin(0).setStrokeStyle(1, 0x2c4258);
      bg.setInteractive();
      bg.on('pointerdown', () => this.onBayClicked(i));
      const title = this.add.text(x + 6, y + 4, bayName(i, cols), TS(11, '#5d7a94'));
      this.add.rectangle(x + 6, y + 20, bw - 12, 5, 0x0b141d).setOrigin(0);
      const wfill = this.add.rectangle(x + 6, y + 20, bw - 12, 5, 0x4fc3f7).setOrigin(0);
      wfill.scaleX = 0.001;
      const boxes = this.add.container(x, y + 26);
      const dmg = this.add.text(x + bw / 2, y + bh / 2, '', TS(13, '#ff6b6b', { fontStyle: 'bold' })).setOrigin(0.5).setVisible(false);
      this.bayViews.push({ bg, title, wfill, boxes, dmg, bw, bh, x, y });
    }
    this.deckBottom = areaY + rows * bh + (rows - 1) * gap;
    this.ui.deckLoadText = this.add.text(16, this.deckBottom + 6, '', TS(12, '#7d93a8'));
  }

  buildDocks() {
    const x = 624, w = 348, top = 76, bottom = 470, gap = 10, n = this.cfg.docks;
    const h = Math.floor((bottom - top - (n - 1) * gap) / n);
    this.add.text(624, 58, '停靠泊位', TS(12, '#7d93a8'));
    this.dockViews = [];
    for (let i = 0; i < n; i++) {
      const y = top + i * (h + gap);
      const bg = this.add.rectangle(x, y, w, h, 0x101c2b).setOrigin(0).setStrokeStyle(1, 0x2c4258);
      bg.setInteractive();
      bg.on('pointerdown', () => this.onDockPanelClicked(i));
      const icon = this.add.image(x + 12, y + 12, 'ship_in').setOrigin(0).setVisible(false);
      const nameT = this.add.text(x + 68, y + 8, '', TS(13, '#dff3ff', { fontStyle: 'bold' }));
      const kindT = this.add.text(x + 68, y + 27, '', TS(11, '#4fc3f7'));
      this.add.rectangle(x + 150, y + 34, 120, 8, 0x0b141d).setOrigin(0, 0.5);
      const barFill = this.add.rectangle(x + 150, y + 34, 120, 8, 0x7dd87d).setOrigin(0, 0.5);
      const timeT = this.add.text(x + 276, y + 27, '', TS(11, '#9fb7cc')).setOrigin(1, 0);
      const departBtn = makeButton(this, x + w - 34, y + 18, 56, 20, '离港', () => this.resolveDeparture(i, 'manual'), { fontSize: 11 });
      departBtn.setVisible(false);
      const content = this.add.container(x + 8, y + 46);
      const empty = this.add.text(x + w / 2, y + h / 2 + 6, '等待船只入港…', TS(12, '#3d5468')).setOrigin(0.5);
      this.dockViews.push({ bg, icon, nameT, kindT, barFill, timeT, departBtn, content, empty, x, y, w, h });
    }
    this.docksBottom = bottom;
  }

  buildRightPanels() {
    const x = 984, w = 280;
    this.add.text(x, 58, '入港队列', TS(12, '#7d93a8'));
    this.add.rectangle(x, 76, w, 132, 0x0d1622).setOrigin(0).setStrokeStyle(1, 0x22364a);
    this.queueList = this.add.container(x + 10, 86);

    if (this.contractMode) {
      // 合同进度
      this.add.text(x, 216, '合同进度', TS(12, '#7d93a8'));
      this.add.rectangle(x, 234, w, 124, 0x0d1622).setOrigin(0).setStrokeStyle(1, 0x3a4a66);
      this.contractRows = [];
      for (let i = 0; i < CONTRACT_MAX_ACCEPT; i++) {
        const row = {
          bg: this.add.rectangle(x + w / 2, 252 + i * 52, w - 10, 46, 0x14202e).setStrokeStyle(1, 0x2c4258),
          head: this.add.text(x + 10, 240 + i * 52, '', TS(11, '#dff3ff', { fontStyle: 'bold' })),
          prog: this.add.text(x + 10, 256 + i * 52, '', TS(10, '#9fb7cc')),
          due:  this.add.text(x + w - 10, 240 + i * 52, '', TS(10, '#9fb7cc')).setOrigin(1, 0),
        };
        this.contractRows.push(row);
      }

      // 市场行情
      this.add.text(x, 366, '市场行情', TS(12, '#7d93a8'));
      this.add.rectangle(x, 384, w, 104, 0x0d1622).setOrigin(0).setStrokeStyle(1, 0x3a4a66);
      this.marketRows = {};
      CARGO_KEYS.forEach((k, i) => {
        const ct = CARGO_TYPES[k];
        this.add.rectangle(x + 14, 400 + i * 20, 8, 8, ct.color);
        this.marketRows[k] = {
          price: this.add.text(x + 26, 392 + i * 20, '', TS(11, '#cfe6f5')),
          delta: this.add.text(x + w - 12, 392 + i * 20, '', TS(11, '#9fb7cc')).setOrigin(1, 0),
        };
      });
      this.marketTimerText = this.add.text(x + 10, 466, '', TS(10, '#5d7a94'));

      // 航线统计（精简）
      this.add.text(x, 496, '航线统计', TS(12, '#7d93a8'));
      this.add.rectangle(x, 514, w, 112, 0x0d1622).setOrigin(0).setStrokeStyle(1, 0x22364a);
      const bestC = loadBestContracts()[this.cfg.key] || 0;
      this.statsTexts = {
        done:     this.add.text(x + 12, 522, '', TS(11, '#9fb7cc')),
        contract: this.add.text(x + 12, 540, '', TS(11, '#9fb7cc')),
        missed:   this.add.text(x + 12, 558, '', TS(11, '#9fb7cc')),
        stolen:   this.add.text(x + 12, 576, '', TS(11, '#9fb7cc')),
        time:     this.add.text(x + 12, 594, '', TS(11, '#9fb7cc')),
        best:     this.add.text(x + 12, 612, `最佳合同收益：${bestC}`, TS(11, '#ffd24a')),
      };

      // 操作提示（精简）
      this.add.rectangle(x, 636, w, 56, 0x0d1622).setOrigin(0).setStrokeStyle(1, 0x22364a);
      this.add.text(x + 10, 644,
        '按合同目的地装货可结算倍率与行情收益\n价格每 60 秒波动 · 空格暂停 · Z 撤销 · M 静音',
        TS(10, '#7d93a8', { lineSpacing: 6 }));
      return;
    }

    this.add.text(x, 260, '航线统计', TS(12, '#7d93a8'));
    this.add.rectangle(x, 280, w, 144, 0x0d1622).setOrigin(0).setStrokeStyle(1, 0x22364a);
    const best = loadBest()[this.cfg.key] || 0;
    this.statsTexts = {
      done:     this.add.text(x + 12, 290, '', TS(12, '#9fb7cc')),
      unloaded: this.add.text(x + 12, 312, '', TS(12, '#9fb7cc')),
      missed:   this.add.text(x + 12, 334, '', TS(12, '#9fb7cc')),
      stolen:   this.add.text(x + 12, 356, '', TS(12, '#9fb7cc')),
      time:     this.add.text(x + 12, 378, '', TS(12, '#9fb7cc')),
      best:     this.add.text(x + 12, 400, `历史最高：${best}`, TS(12, '#ffd24a')),
    };

    this.add.text(x, 440, '操作指南', TS(12, '#7d93a8'));
    this.add.rectangle(x, 460, w, 232, 0x0d1622).setOrigin(0).setStrokeStyle(1, 0x22364a);
    const help = [
      '· 点击货物 → 选择 / 再点取消',
      '· 点击舱位 → 放入选中货物',
      '· 点击装货船面板 → 装载',
      '· 点击同类货物 → 合并(≤3件)',
      '· 选中后可用 [拆分] 分离堆叠',
      '· 卸货船→装货船 优先直转',
      '· 右键 / ESC 取消选择',
      '· 空格 暂停规划 · Z 撤销 · M 静音',
      '',
      '【目标】',
      '完成装货订单赚取分数与燃料，',
      '稳定度归零则空间站瘫痪！',
    ].join('\n');
    this.add.text(x + 12, 470, help, TS(11, '#7d93a8', { lineSpacing: 5 }));
  }

  buildBanner() {
    this.add.text(624, this.docksBottom + 8, '状态 / 警报', TS(12, '#7d93a8'));
    this.bannerBox = this.add.container(624, this.docksBottom + 30);
    this.bannerCountdown = null;
    this.bannerEventText = null;
  }

  buildActionBar() {
    this.actionBox = this.add.container(16, this.deckBottom + 32);
  }

  buildLogView() {
    this.logLines = [];
    this.logTexts = [];
    const y = this.deckBottom + 70;
    for (let i = 0; i < 3; i++) {
      this.logTexts.push(this.add.text(16, y + i * 20, '', TS(12, '#9fb7cc')));
    }
  }

  buildPauseOverlay() {
    this.pauseOverlay = this.add.container(0, 0).setVisible(false).setDepth(50);
    const dim = this.add.rectangle(0, 0, 1280, 720, 0x000000, 0.22).setOrigin(0);
    const t = this.add.text(640, 64, '⏸ 已暂停 — 可继续规划操作，按空格继续', TS(20, '#7fe3ff', { fontStyle: 'bold' })).setOrigin(0.5);
    this.pauseOverlay.add([dim, t]);
  }

  setupInput() {
    this.input.keyboard.on('keydown-SPACE', () => this.togglePause());
    this.input.keyboard.on('keydown-Z', () => this.undo());
    this.input.keyboard.on('keydown-M', () => {
      const m = Sfx.toggleMute();
      this.addLog(m ? '🔇 已静音' : '🔊 声音开启', '#9fb7cc');
    });
    this.input.keyboard.on('keydown-ESC', () => this.clearSelection());
    this.input.mouse.disableContextMenu();
    this.input.on('pointerdown', (p) => { if (p.rightButtonDown()) this.clearSelection(); });
  }

  /* ================= 主循环 ================= */

  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.1);
    if (this.contractMode && this.intro) { this.refreshFrame(); return; }
    if (!this.state.paused && !this.state.gameOver) this.tick(dt);
    this.refreshFrame();
  }

  tick(dt) {
    const st = this.state;
    st.time += dt;
    st.fuel = Math.min(FUEL_MAX, st.fuel + this.cfg.fuelRegen * dt);

    // 新船生成
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = rand(this.cfg.spawnInterval[0], this.cfg.spawnInterval[1]);
      if (st.queue.length < 5) this.enqueueShip();
    }
    // 队列倒计时 & 入泊
    for (const q of st.queue) if (q.eta > 0) q.eta -= dt;
    for (let i = 0; i < st.docks.length; i++) {
      if (st.docks[i]) continue;
      const idx = st.queue.findIndex(q => q.eta <= 0);
      if (idx >= 0) {
        const ship = st.queue.splice(idx, 1)[0];
        this.dockShip(ship, i);
      }
    }
    // 停靠船只倒计时
    for (let i = 0; i < st.docks.length; i++) {
      const sh = st.docks[i];
      if (!sh) continue;
      sh.timeLeft -= dt;
      if (sh.timeLeft <= 0) { sh.timeLeft = 0; this.resolveDeparture(i, 'timeout'); }
    }
    // 突发事件
    if (st.crisis) this.tickCrisis(dt);
    else {
      this.eventTimer -= dt;
      if (this.eventTimer <= 0) this.triggerEvent();
    }
    // 氧气
    if (st.leak) st.oxygen = Math.max(0, st.oxygen - 4 * dt);
    else st.oxygen = Math.min(100, st.oxygen + 5 * dt);
    // 稳定度
    let ds = 0;
    const ratio = this.deckLoadRatio();
    if (!st.crisis && ratio < 0.85) ds += 0.5;
    if (ratio >= 0.9) ds -= 0.8;
    if (st.fuel < 1) ds -= 1.5;
    if (st.oxygen <= 0) ds -= 3;
    st.stability = clamp(st.stability + ds * dt, 0, 100);
    if (st.stability <= 0) { this.gameOver('稳定度归零，空间站陷入混乱！'); return; }

    if (this.contractMode) {
      this.tickContracts(dt);
      if (!st.gameOver) {
        this.saveTimer += dt;
        if (this.saveTimer >= 4) { this.saveTimer = 0; this.saveRun(); }
      }
    }
  }

  refreshFrame() {
    const st = this.state, ui = this.ui;
    setTxt(ui.scoreVal, String(st.score));
    ui.fuelFill.scaleX = clamp(st.fuel / FUEL_MAX, 0.001, 1);
    setTxt(ui.fuelVal, String(Math.floor(st.fuel)));
    ui.stabFill.scaleX = clamp(st.stability / 100, 0.001, 1);
    const sc = st.stability > 50 ? 0x7dd87d : st.stability > 25 ? 0xffb74d : 0xff5252;
    if (ui.stabFill.__c !== sc) { ui.stabFill.__c = sc; ui.stabFill.setFillStyle(sc); }
    setTxt(ui.stabVal, String(Math.floor(st.stability)));
    ui.oxyFill.scaleX = clamp(st.oxygen / 100, 0.001, 1);
    setTxt(ui.oxyVal, String(Math.floor(st.oxygen)));
    setTxt(ui.timeText, fmtTime(st.time));

    // 甲板负荷
    const tw = this.totalDeckWeight(), cap = st.bays.length * BAY_MAX_WEIGHT;
    const over = tw / cap >= 0.9;
    setTxt(ui.deckLoadText, `甲板负荷 ${tw}/${cap}${over ? ' ⚠ 超载' : ''}`);
    ui.deckLoadText.setColor(over ? '#ff8a80' : '#7d93a8');

    // 泊位倒计时
    this.dockViews.forEach((v, i) => {
      const ship = st.docks[i];
      if (!ship) return;
      const r = clamp(ship.timeLeft / ship.totalTime, 0, 1);
      v.barFill.scaleX = Math.max(0.001, r);
      const c = r > 0.5 ? 0x7dd87d : r > 0.25 ? 0xffb74d : 0xff5252;
      if (v.barFill.__c !== c) { v.barFill.__c = c; v.barFill.setFillStyle(c); }
      setTxt(v.timeT, Math.ceil(ship.timeLeft) + 's');
    });
    // 舱位受损倒计时
    this.bayViews.forEach((v, i) => {
      const bay = st.bays[i];
      if (bay.damagedUntil > st.time) {
        v.dmg.setVisible(true);
        setTxt(v.dmg, `🛠 受损 ${Math.ceil(bay.damagedUntil - st.time)}s`);
      } else if (v.dmg.visible) {
        this.renderBay(i);
      }
    });
    // 队列 ETA
    this.queueEtaTexts.forEach(({ ship, eta }) => {
      if (ship.eta > 0) { setTxt(eta, Math.ceil(ship.eta) + 's'); eta.setColor('#9fb7cc'); }
      else { setTxt(eta, '等泊位'); eta.setColor('#ffb74d'); }
    });
    // 警报倒计时
    if (st.crisis && this.bannerCountdown) {
      if (st.crisis.type === 'pirate') setTxt(this.bannerCountdown, `劫掠倒计时：${Math.ceil(st.crisis.timeLeft)}s — 不防御将损失货物`);
      if (st.crisis.type === 'damage') setTxt(this.bannerCountdown, `自动修复：${Math.max(0, Math.ceil(st.bays[st.crisis.bay].damagedUntil - st.time))}s`);
    }
    if (!st.crisis && this.bannerEventText) setTxt(this.bannerEventText, `下一事件：约 ${Math.ceil(this.eventTimer)}s 后`);

    // 统计
    if (this.contractMode) {
      setTxt(this.statsTexts.done, `装货订单：${this.stats.done} · 卸货：${this.stats.unloaded}`);
      setTxt(this.statsTexts.contract, `合同 完成${this.stats.contractDone} / 逾期${this.stats.contractExpired}`);
      setTxt(this.statsTexts.missed, `错失船只：${this.stats.missed} · 被掠：${this.stats.stolen}`);
      setTxt(this.statsTexts.stolen, `合同结算：${this.earnings.base + this.earnings.market + this.earnings.time}`);
      setTxt(this.statsTexts.time, `计时：${fmtTime(st.time)}`);
      this.refreshContractPanel();
      this.refreshMarketPanel();
    } else {
      setTxt(this.statsTexts.done, `完成订单：${this.stats.done}`);
      setTxt(this.statsTexts.unloaded, `卸货完成：${this.stats.unloaded}`);
      setTxt(this.statsTexts.missed, `错失船只：${this.stats.missed}`);
      setTxt(this.statsTexts.stolen, `被掠货物：${this.stats.stolen}`);
      setTxt(this.statsTexts.time, `存活时间：${fmtTime(st.time)}`);
    }
  }

  refreshContractPanel() {
    if (!this.contractRows) return;
    const active = this.contracts.filter(c => c.status === 'active');
    this.contractRows.forEach((row, i) => {
      const c = active[i];
      if (!c) {
        row.bg.setVisible(false).setStrokeStyle(1, 0x2c4258);
        [row.head, row.prog, row.due].forEach(t => setTxt(t, ''));
        return;
      }
      row.bg.setVisible(true);
      const left = c.deadline - this.state.time;
      const overdueSoon = left <= 15;
      const color = overdueSoon ? '#ff8a80' : '#dff3ff';
      const progStr = CARGO_KEYS.filter(k => c.req[k] > 0)
        .map(k => `${CARGO_TYPES[k].short}${Math.min(c.done[k], c.req[k])}/${c.req[k]}`).join(' ');
      setTxt(row.head, `[${c.id}] ${truncate(c.dest, 7)} ×${c.mult.toFixed(1)}`);
      row.head.setColor(color);
      setTxt(row.prog, `${comboText(c.req)}  ${progStr}`);
      setTxt(row.due, left > 0 ? `⏱ ${Math.ceil(left)}s` : '逾期!');
      row.due.setColor(overdueSoon ? '#ff8a80' : '#9fb7cc');
      row.bg.setStrokeStyle(1, overdueSoon ? 0xff5252 : 0x3a4a66);
    });
  }

  refreshMarketPanel() {
    if (!this.marketRows) return;
    CARGO_KEYS.forEach(k => {
      const p = this.market.prices[k], base = MARKET.base[k], prev = this.market.last[k];
      setTxt(this.marketRows[k].price, `${CARGO_TYPES[k].name}  ${p}`);
      const pct = Math.round((p / base - 1) * 100);
      const tick = p > prev ? '▲' : p < prev ? '▼' : '·';
      setTxt(this.marketRows[k].delta, `${tick}${pct > 0 ? '+' : ''}${pct}%`);
      this.marketRows[k].delta.setColor(p > prev ? '#9dff9d' : p < prev ? '#ff8a80' : '#9fb7cc');
    });
    setTxt(this.marketTimerText, `下次波动：${Math.ceil(this.market.timer)}s · 基础 ${MARKET.base.ore}/${MARKET.base.energy}/${MARKET.base.supply}`);
  }

  /* ================= 渲染 ================= */

  renderAll() {
    for (let i = 0; i < this.state.bays.length; i++) this.renderBay(i);
    for (let i = 0; i < this.state.docks.length; i++) this.renderDock(i);
    this.renderQueue();
    this.renderBanner();
    this.renderActionBar();
    this.refreshUndoBtn();
  }

  createContainerBox(c, cx, cy, onClick, small) {
    const w = small ? 46 : 64, h = small ? 24 : 32;
    const g = this.add.container(cx, cy);
    const ct = CARGO_TYPES[c.type];
    const isSel = this.selected && this.selected.id === c.id;
    const bg = this.add.rectangle(0, 0, w, h, ct.color);
    bg.setStrokeStyle(isSel ? 3 : 1, isSel ? 0xffffff : 0x000000, isSel ? 1 : 0.35);
    const label = this.add.text(0, small ? 0 : -4, ct.short + (c.units > 1 ? '×' + c.units : ''), TS(small ? 12 : 15, ct.textColor, { fontStyle: 'bold' })).setOrigin(0.5);
    g.add([bg, label]);
    if (!small) {
      const wt = this.add.text(0, 9, '重' + weightOf(c), TS(9, ct.textColor)).setOrigin(0.5);
      wt.setAlpha(0.75);
      g.add(wt);
    }
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerdown', () => onClick());
    return g;
  }

  renderBay(i) {
    const bay = this.state.bays[i], v = this.bayViews[i];
    v.boxes.removeAll(true);
    const damaged = bay.damagedUntil > this.state.time;
    v.bg.setStrokeStyle(damaged ? 2 : 1, damaged ? 0xff5252 : 0x2c4258);
    v.bg.setFillStyle(damaged ? 0x2a1420 : 0x14202e);
    v.dmg.setVisible(damaged);
    bay.containers.forEach((c, idx) => {
      const box = this.createContainerBox(c, v.bw / 2, 22 + idx * 38, () => this.onContainerClicked('bay', i, c.id));
      v.boxes.add(box);
    });
    const w = bayWeight(bay), ratio = w / BAY_MAX_WEIGHT;
    v.wfill.scaleX = Math.max(0.001, Math.min(1, ratio));
    v.wfill.setFillStyle(ratio >= 1 ? 0xff5252 : ratio >= 0.66 ? 0xffb74d : 0x4fc3f7);
  }

  renderDock(i) {
    const ship = this.state.docks[i], v = this.dockViews[i];
    v.content.removeAll(true);
    if (!ship) {
      v.icon.setVisible(false);
      setTxt(v.nameT, '泊位空闲'); v.nameT.setColor('#3d5468');
      setTxt(v.kindT, ''); setTxt(v.timeT, '');
      v.barFill.scaleX = 0.001;
      v.departBtn.setVisible(false);
      v.empty.setVisible(true);
      v.bg.setStrokeStyle(1, 0x2c4258);
      return;
    }
    v.empty.setVisible(false);
    v.icon.setVisible(true).setTexture(ship.kind === 'unloader' ? 'ship_in' : 'ship_out');
    setTxt(v.nameT, truncate(ship.name, 15)); v.nameT.setColor('#dff3ff');
    setTxt(v.kindT, ship.kind === 'unloader' ? '▼ 卸货船'
      : ('▲ 装货船' + (this.contractMode && ship.contractId != null ? ' · 📜合同' : '')));
    v.kindT.setColor(ship.kind === 'unloader' ? '#4fc3f7' : (ship.contractId != null ? '#c79fff' : '#ffb74d'));
    v.departBtn.setVisible(true);
    v.bg.setStrokeStyle(1, ship.kind === 'unloader' ? 0x2a6a8a : 0x8a6a2a);

    if (ship.kind === 'unloader') {
      v.content.add(this.add.text(0, 0, '船舱货物（点击选择，搬入舱位或直转装货船）', TS(10, '#5d7a94')));
      ship.cargo.forEach((c, idx) => {
        const col = idx % 5, row = Math.floor(idx / 5);
        v.content.add(this.createContainerBox(c, 30 + col * 64, 26 + row * 38, () => this.onContainerClicked('shipCargo', i, c.id)));
      });
    } else {
      let cx = 0;
      CARGO_KEYS.forEach(k => {
        const req = ship.requires[k] || 0;
        if (!req) return;
        const got = Math.min(ship.loaded[k], req);
        const done = got >= req;
        const chip = this.add.container(40 + cx * 88, 14);
        const bg = this.add.rectangle(0, 0, 80, 24, done ? 0x2e5d3a : CARGO_TYPES[k].color)
          .setStrokeStyle(1, done ? 0x7dd87d : 0x000000, done ? 1 : 0.3);
        const t = this.add.text(0, 0, `${CARGO_TYPES[k].short} ${got}/${req}${done ? ' ✓' : ''}`,
          TS(12, done ? '#c8ffc8' : CARGO_TYPES[k].textColor, { fontStyle: 'bold' })).setOrigin(0.5);
        chip.add([bg, t]);
        v.content.add(chip);
        cx++;
      });
      v.content.add(this.add.text(0, 34, '已装货物（点击可卸下）：', TS(10, '#5d7a94')));
      ship.loadedContainers.forEach((c, idx) => {
        const col = idx % 6, row = Math.floor(idx / 6);
        v.content.add(this.createContainerBox(c, 26 + col * 52, 52 + row * 30, () => this.onContainerClicked('shipLoad', i, c.id), true));
      });
      if (!ship.loadedContainers.length) {
        v.content.add(this.add.text(0, 52, '— 选中货物后点击本面板装载 —', TS(10, '#3d5468')));
      }
    }
  }

  renderQueue() {
    this.queueList.removeAll(true);
    this.queueEtaTexts = [];
    this.state.queue.forEach((ship, idx) => {
      const y = idx * 26;
      const dot = this.add.rectangle(4, y + 8, 8, 8, ship.kind === 'unloader' ? 0x4fc3f7 : 0xffb74d);
      const name = this.add.text(18, y, truncate(ship.name, 12), TS(12, '#cfe6f5'));
      const kind = this.add.text(150, y, ship.kind === 'unloader' ? '卸货' : '装货', TS(11, ship.kind === 'unloader' ? '#4fc3f7' : '#ffb74d'));
      const eta = this.add.text(250, y, '', TS(11, '#9fb7cc')).setOrigin(1, 0);
      this.queueList.add([dot, name, kind, eta]);
      this.queueEtaTexts.push({ ship, eta });
    });
    if (!this.state.queue.length) {
      this.queueList.add(this.add.text(0, 0, '— 暂无船只 —', TS(11, '#3d5468')));
    }
  }

  renderBanner() {
    this.bannerBox.removeAll(true);
    this.bannerCountdown = null;
    this.bannerEventText = null;
    const st = this.state, w = 348;
    if (st.crisis) {
      const c = st.crisis;
      this.bannerBox.add(this.add.rectangle(0, 0, w, 110, 0x2a1420).setOrigin(0).setStrokeStyle(2, 0xff5252));
      let title = '', desc = '', btnLabel = '', btnCb = null, btnW = 170;
      if (c.type === 'leak') {
        title = '⚠ 氧气泄漏！';
        desc = '氧气持续下降，归零后稳定度快速流失';
        btnLabel = `🔧 修复 · ${COST.REPAIR_LEAK} 燃料`; btnCb = () => this.repairLeak();
      } else if (c.type === 'pirate') {
        title = '☠ 海盗袭击！';
        btnLabel = `🛡 防御 · ${COST.DEFEND} 燃料`; btnCb = () => this.defend();
        this.bannerCountdown = this.add.text(12, 36, '', TS(13, '#ffb0a8'));
        this.bannerBox.add(this.bannerCountdown);
      } else {
        title = `🔧 舱位 ${bayName(c.bay, this.cfg.bayCols)} 受损！`;
        btnLabel = `立即修复 · ${COST.REPAIR_BAY} 燃料`; btnCb = () => this.repairBay();
        this.bannerCountdown = this.add.text(12, 36, '', TS(13, '#ffb0a8'));
        this.bannerBox.add(this.bannerCountdown);
      }
      this.bannerBox.add(this.add.text(12, 10, title, TS(16, '#ff8a80', { fontStyle: 'bold' })));
      if (desc) this.bannerBox.add(this.add.text(12, 36, desc, TS(12, '#ffb0a8')));
      this.bannerBox.add(makeButton(this, 12 + btnW / 2, 86, btnW, 26, btnLabel, btnCb,
        { fontSize: 12, bg: 0x5d2a2a, hover: 0x7a3a3a, stroke: 0xff8a80 }));
    } else {
      this.bannerBox.add(this.add.rectangle(0, 0, w, 110, 0x0d1622).setOrigin(0).setStrokeStyle(1, 0x22364a));
      const lines = [];
      if (this.deckLoadRatio() >= 0.9) lines.push(['⚠ 甲板超载！稳定度持续下降', '#ff8a80']);
      if (st.fuel < 10) lines.push(['⚠ 燃料不足，完成订单可补充', '#ffb74d']);
      if (!lines.length) lines.push(['✔ 各系统运行正常', '#7dd87d']);
      lines.forEach((l, i) => this.bannerBox.add(this.add.text(12, 12 + i * 22, l[0], TS(12, l[1]))));
      this.bannerEventText = this.add.text(12, 78, '', TS(11, '#4a6076'));
      this.bannerBox.add(this.bannerEventText);
    }
  }

  renderActionBar() {
    this.actionBox.removeAll(true);
    let sel = this.selected;
    const c = sel ? this.findContainer(sel) : null;
    if (sel && !c) { this.selected = null; sel = null; }
    if (sel && c) {
      this.actionBox.add(this.add.text(0, 0,
        `已选：${cargoName(c)}（重${weightOf(c)}）→ 点击舱位放入 / 点击装货船装载 / 点击同类货物合并`,
        TS(13, '#ffd24a')));
      if (sel.kind === 'bay' && c.units > 1) {
        this.actionBox.add(makeButton(this, 452, 10, 64, 24, '拆分', () => this.doSplit(), { fontSize: 12 }));
      }
      this.actionBox.add(makeButton(this, 530, 10, 64, 24, '取消', () => this.clearSelection(), { fontSize: 12 }));
    } else {
      this.actionBox.add(this.add.text(0, 0, '点击货物进行选择 · 合并同类货物节省舱位 · 注意载重上限', TS(12, '#4a6076')));
    }
  }

  refreshUndoBtn() {
    if (this.ui.undoBtn) this.ui.undoBtn.setLabel(`↩ 撤销(${this.undoStack.length})`);
  }

  addLog(msg, color) {
    this.logLines.push({ msg, color: color || '#9fb7cc' });
    if (this.logLines.length > 30) this.logLines.shift();
    const last = this.logLines.slice(-3);
    this.logTexts.forEach((t, i) => {
      const l = last[i];
      if (l) { t.setText(l.msg); t.setColor(l.color); } else t.setText('');
    });
  }

  floatText(x, y, msg, color) {
    const t = this.add.text(x, y, msg, TS(18, color || '#ffffff', { fontStyle: 'bold' })).setOrigin(0.5).setDepth(60);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 1200, onComplete: () => t.destroy() });
  }

  /* ================= 选择与查找 ================= */

  select(kind, key, id) {
    this.selected = { kind, key, id };
    Sfx.click();
    this.renderAll();
  }

  clearSelection() {
    if (this.selected) { this.selected = null; this.renderAll(); }
  }

  findContainer(sel) {
    if (!sel) return null;
    if (sel.kind === 'bay') {
      const b = this.state.bays[sel.key];
      return b ? (b.containers.find(c => c.id === sel.id) || null) : null;
    }
    const sh = this.state.docks[sel.key];
    if (!sh) return null;
    if (sel.kind === 'shipCargo') return sh.cargo.find(c => c.id === sel.id) || null;
    if (sel.kind === 'shipLoad') return sh.loadedContainers.find(c => c.id === sel.id) || null;
    return null;
  }

  removeFromSource(sel) {
    if (sel.kind === 'bay') {
      const b = this.state.bays[sel.key];
      const i = b.containers.findIndex(c => c.id === sel.id);
      if (i >= 0) b.containers.splice(i, 1);
      return;
    }
    const sh = this.state.docks[sel.key];
    if (!sh) return;
    if (sel.kind === 'shipCargo') {
      const i = sh.cargo.findIndex(c => c.id === sel.id);
      if (i >= 0) sh.cargo.splice(i, 1);
    } else {
      const i = sh.loadedContainers.findIndex(c => c.id === sel.id);
      if (i >= 0) {
        const c = sh.loadedContainers[i];
        sh.loadedContainers.splice(i, 1);
        sh.loaded[c.type] -= c.units;
      }
    }
  }

  canPlace(bay, c) {
    return bay.damagedUntil <= this.state.time
      && bay.containers.length < BAY_MAX_STACK
      && bayWeight(bay) + weightOf(c) <= BAY_MAX_WEIGHT;
  }

  hasFuel(n) {
    if (this.state.fuel < n) {
      this.addLog(`燃料不足（需要 ${n}）`, '#ff8a80');
      Sfx.error();
      return false;
    }
    return true;
  }

  /* ================= 玩家操作 ================= */

  onBayClicked(i) {
    if (this.state.gameOver || this.intro) return;
    const sel = this.selected;
    if (!sel) return;
    if (sel.kind === 'bay' && sel.key === i) { this.clearSelection(); return; }
    const c = this.findContainer(sel);
    if (!c) { this.clearSelection(); return; }
    const bay = this.state.bays[i];
    if (!this.canPlace(bay, c)) {
      this.addLog(`无法放入 ${bayName(i, this.cfg.bayCols)}：满载 / 超重 / 受损`, '#ff8a80');
      Sfx.error();
      return;
    }
    if (!this.hasFuel(COST.MOVE)) return;
    this.snapshot();
    this.state.fuel -= COST.MOVE;
    const fromDock = (sel.kind === 'shipCargo') ? sel.key : -1;
    this.removeFromSource(sel);
    bay.containers.push(c);
    this.addLog(`📦 ${cargoName(c)} → 舱位 ${bayName(i, this.cfg.bayCols)}`, '#cfe6f5');
    Sfx.place();
    this.selected = null;
    this.renderAll();
    if (fromDock >= 0) this.checkUnloaderDone(fromDock);
  }

  onContainerClicked(kind, key, id) {
    if (this.state.gameOver || this.intro) return;
    const sel = this.selected;
    if (sel && sel.kind === kind && sel.key === key && sel.id === id) { this.clearSelection(); return; }
    // 合并：已选中舱内货物，点击同类舱内货物
    if (sel && kind === 'bay' && sel.kind === 'bay') {
      const a = this.findContainer(sel);
      const b = this.findContainer({ kind: 'bay', key, id });
      if (a && b && a.type === b.type) {
        if (a.units + b.units <= 3) { this.doMerge(sel, { kind: 'bay', key, id }); return; }
        this.addLog('合并失败：单箱最多 3 件', '#ff8a80');
        Sfx.error();
        return;
      }
    }
    this.select(kind, key, id);
  }

  onDockPanelClicked(i) {
    if (this.state.gameOver || this.intro) return;
    const ship = this.state.docks[i];
    if (!ship) return;
    if (ship.kind !== 'loader') {
      if (this.selected) { this.addLog('卸货船不接收货物', '#ff8a80'); Sfx.error(); }
      return;
    }
    const sel = this.selected;
    if (!sel || sel.kind === 'shipLoad') return;
    const c = this.findContainer(sel);
    if (!c) { this.clearSelection(); return; }
    const need = ship.requires[c.type] || 0;
    const remaining = need - ship.loaded[c.type];
    if (remaining <= 0) {
      this.addLog(`${truncate(ship.name, 10)} 不需要更多${CARGO_TYPES[c.type].name}`, '#ff8a80');
      Sfx.error();
      return;
    }
    // 整箱超过剩余需求时拒收，提示先拆分，避免超出部分被浪费
    if (c.units > remaining) {
      this.addLog(`只需 ${remaining} 件${CARGO_TYPES[c.type].name}，整箱超出需求 — 请先拆分`, '#ff8a80');
      Sfx.error();
      return;
    }
    const cost = sel.kind === 'shipCargo' ? COST.DIRECT : COST.MOVE;   // 卸货船→装货船 优先直转
    if (!this.hasFuel(cost)) return;
    this.snapshot();
    this.state.fuel -= cost;
    const fromDock = sel.kind === 'shipCargo' ? sel.key : -1;
    this.removeFromSource(sel);
    ship.loadedContainers.push(c);
    ship.loaded[c.type] += c.units;
    this.addLog(`🚀 ${cargoName(c)} 装载 → ${truncate(ship.name, 12)}${cost === COST.DIRECT ? '（优先直转）' : ''}`, '#cfe6f5');
    Sfx.place();
    this.selected = null;
    this.renderAll();
    if (fromDock >= 0) this.checkUnloaderDone(fromDock);
    this.checkLoaderComplete(i);
  }

  doMerge(selA, selB) {
    const a = this.findContainer(selA), b = this.findContainer(selB);
    if (!a || !b) { this.clearSelection(); return; }
    if (!this.hasFuel(COST.MERGE)) return;
    this.snapshot();
    this.state.fuel -= COST.MERGE;
    this.removeFromSource(selA);
    this.removeFromSource(selB);
    const merged = { id: this.containerSeq++, type: a.type, units: a.units + b.units };
    const order = [selB.key, selA.key, ...this.state.bays.keys()];
    for (const idx of order) {
      const bay = this.state.bays[idx];
      if (this.canPlace(bay, merged)) {
        bay.containers.push(merged);
        this.addLog(`🧲 合并为 ${cargoName(merged)} → 舱位 ${bayName(idx, this.cfg.bayCols)}`, '#cfe6f5');
        Sfx.merge();
        this.selected = null;
        this.renderAll();
        return;
      }
    }
    // 无可用舱位：回滚
    const s = this.undoStack.pop();
    this.applySnapshot(s);
    this.refreshUndoBtn();
    this.addLog('合并失败：没有可用舱位', '#ff8a80');
    Sfx.error();
  }

  doSplit() {
    const sel = this.selected;
    if (!sel || sel.kind !== 'bay') return;
    const c = this.findContainer(sel);
    if (!c || c.units < 2) return;
    if (!this.hasFuel(COST.SPLIT)) return;
    this.snapshot();
    this.state.fuel -= COST.SPLIT;
    c.units -= 1;
    const nc = { id: this.containerSeq++, type: c.type, units: 1 };
    const order = [sel.key, ...this.state.bays.keys()];
    for (const idx of order) {
      if (this.canPlace(this.state.bays[idx], nc)) {
        this.state.bays[idx].containers.push(nc);
        this.addLog(`✂ 拆出 ${cargoName(nc)} → 舱位 ${bayName(idx, this.cfg.bayCols)}`, '#cfe6f5');
        Sfx.place();
        this.selected = null;
        this.renderAll();
        return;
      }
    }
    const s = this.undoStack.pop();
    this.applySnapshot(s);
    this.refreshUndoBtn();
    this.addLog('拆分失败：没有可用舱位', '#ff8a80');
    Sfx.error();
  }

  /* ================= 撤销 ================= */

  snapshot() {
    const st = this.state;
    this.undoStack.push({
      bays: st.bays.map(b => ({ damagedUntil: b.damagedUntil, containers: b.containers.map(c => ({ ...c })) })),
      docks: st.docks.map(sh => sh ? {
        shipId: sh.id,
        cargo: sh.cargo.map(c => ({ ...c })),
        loadedContainers: sh.loadedContainers.map(c => ({ ...c })),
        loaded: { ...sh.loaded },
      } : null),
      fuel: st.fuel, stability: st.stability, oxygen: st.oxygen,
    });
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.refreshUndoBtn();
  }

  applySnapshot(s) {
    const st = this.state;
    s.bays.forEach((sb, i) => {
      st.bays[i].containers = sb.containers.map(c => ({ ...c }));
      st.bays[i].damagedUntil = sb.damagedUntil;
    });
    s.docks.forEach((sd, i) => {
      const sh = st.docks[i];
      if (sh && sd && sh.id === sd.shipId) {
        sh.cargo = sd.cargo.map(c => ({ ...c }));
        sh.loadedContainers = sd.loadedContainers.map(c => ({ ...c }));
        sh.loaded = { ...sd.loaded };
      }
    });
    st.fuel = s.fuel; st.stability = s.stability; st.oxygen = s.oxygen;
    this.selected = null;
    this.renderAll();
  }

  undo() {
    if (this.state.gameOver || this.intro) return;
    const s = this.undoStack.pop();
    if (!s) { this.addLog('没有可撤销的操作', '#4a6076'); return; }
    this.applySnapshot(s);
    this.refreshUndoBtn();
    this.addLog('↩ 已撤销上一步操作', '#cfe6f5');
    Sfx.click();
  }

  /* ================= 船只生命周期 ================= */

  makeContainer(type) {
    const t = type || pick(CARGO_KEYS);
    const r = Math.random();
    const units = r < 0.55 ? 1 : r < 0.85 ? 2 : 3;
    return { id: this.containerSeq++, type: t, units };
  }

  genRequirements() {
    const cfg = this.cfg;
    const total = randInt(cfg.reqUnits[0], cfg.reqUnits[1]);
    const nT = Math.min(3, randInt(cfg.reqTypes[0], cfg.reqTypes[1]));
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

  makeShip(kind) {
    const cfg = this.cfg;
    kind = kind || (Math.random() < cfg.unloaderRatio ? 'unloader' : 'loader');
    const ship = {
      id: this.shipSeq++, kind,
      cargo: [], loadedContainers: [],
      loaded: { ore: 0, energy: 0, supply: 0 },
      requires: null, eta: 0,
      dest: null, contractId: null,
    };
    if (kind === 'unloader') {
      ship.name = pick(SHIP_NAMES);
      const n = randInt(cfg.unloadCount[0], cfg.unloadCount[1]);
      for (let i = 0; i < n; i++) ship.cargo.push(this.makeContainer());
    } else if (this.contractMode && !this.intro) {
      // 合同模式：70% 概率发往在执行合同的目的地，订单直接对应合同货物组合
      const active = this.contracts.filter(c => c.status === 'active' && c.deadline > this.state.time);
      let ctr = null;
      if (active.length && Math.random() < 0.7) ctr = pick(active);
      const baseName = pick(SHIP_NAMES);
      if (ctr) {
        ship.dest = ctr.dest;
        ship.contractId = ctr.id;
        ship.requires = { ...ctr.req };
        ship.name = `${baseName} → ${ctr.dest}`;
      } else {
        ship.dest = pick(DESTINATIONS);
        ship.requires = this.genRequirements();
        ship.name = `${baseName} → ${ship.dest}`;
      }
    } else {
      ship.dest = pick(DESTINATIONS);
      ship.name = pick(SHIP_NAMES) + ' → ' + ship.dest;
      ship.requires = this.genRequirements();
    }
    ship.totalTime = ship.timeLeft = rand(cfg.shipTime[0], cfg.shipTime[1]);
    return ship;
  }

  enqueueShip(kind, eta) {
    const ship = this.makeShip(kind);
    ship.eta = eta != null ? eta : rand(2, 5);
    this.state.queue.push(ship);
    if (this.queueList) this.renderQueue();
  }

  dockShip(ship, i) {
    this.state.docks[i] = ship;
    this.addLog(`🛬 ${truncate(ship.name, 14)} 靠泊 ${i + 1} 号泊位（${ship.kind === 'unloader' ? '卸货' : '装货'}）`, '#7fe3ff');
    Sfx.dock();
    this.renderDock(i);
    this.renderQueue();
  }

  checkUnloaderDone(i) {
    const sh = this.state.docks[i];
    if (sh && sh.kind === 'unloader' && sh.cargo.length === 0) this.resolveDeparture(i, 'done');
  }

  checkLoaderComplete(i) {
    const sh = this.state.docks[i];
    if (!sh || sh.kind !== 'loader') return;
    const done = CARGO_KEYS.every(k => sh.loaded[k] >= (sh.requires[k] || 0));
    if (done) this.resolveDeparture(i, 'complete');
  }

  resolveDeparture(i, reason) {
    const st = this.state;
    const ship = st.docks[i];
    if (!ship || st.gameOver) return;
    st.docks[i] = null;
    this.undoStack.length = 0;   // 船只离港后不可再撤销
    this.refreshUndoBtn();
    const v = this.dockViews[i];
    const fx = v.x + v.w / 2, fy = v.y + 30;

    if (ship.kind === 'unloader') {
      const left = ship.cargo.length;
      if (left === 0) {
        st.score += 15;
        st.fuel = Math.min(FUEL_MAX, st.fuel + 4);
        this.stats.unloaded++;
        this.addLog(`✅ ${truncate(ship.name, 12)} 卸货完毕离港 +15 分 +4 燃料`, '#9dff9d');
        this.floatText(fx, fy, '+15', '#7fe3ff');
        Sfx.success();
      } else {
        const pen = 6 * left;
        st.stability = Math.max(0, st.stability - pen);
        this.stats.missed++;
        this.addLog(`⚠ ${truncate(ship.name, 12)} 滞留 ${left} 箱货物离港！稳定度 -${pen}`, '#ff8a80');
        Sfx.error();
        this.cameras.main.shake(150, 0.004);
      }
    } else if (this.contractMode) {
      this.settleLoaderContract(ship, fx, fy);
    } else {
      let reqTotal = 0, fulfilled = 0, value = 0;
      CARGO_KEYS.forEach(k => {
        const req = ship.requires[k] || 0;
        reqTotal += req;
        const got = Math.min(ship.loaded[k], req);
        fulfilled += got;
        value += got * CARGO_TYPES[k].value;
      });
      if (fulfilled >= reqTotal && reqTotal > 0) {
        const bonus = Math.round(value * 0.5);
        const tb = Math.max(0, Math.ceil(ship.timeLeft));
        const gain = value + bonus + tb;
        st.score += gain;
        st.fuel = Math.min(FUEL_MAX, st.fuel + 8);
        st.stability = Math.min(100, st.stability + 4);
        this.stats.done++;
        this.addLog(`✅ 订单完成！+${gain} 分（奖励 ${bonus}+${tb}）+8 燃料`, '#9dff9d');
        this.floatText(fx, fy, '+' + gain, '#ffd24a');
        Sfx.success();
      } else if (fulfilled > 0) {
        // 订单未完成不发放分数，仅扣稳定度
        st.stability = Math.max(0, st.stability - 5);
        this.stats.missed++;
        this.addLog(`⚠ 订单未完成（${fulfilled}/${reqTotal}）离港，稳定度 -5`, '#ffb74d');
        Sfx.error();
      } else {
        st.stability = Math.max(0, st.stability - 8);
        this.stats.missed++;
        this.addLog(`❌ ${truncate(ship.name, 12)} 空船离港！稳定度 -8`, '#ff8a80');
        Sfx.error();
        this.cameras.main.shake(150, 0.004);
      }
    }
    this.renderDock(i);
    if (st.stability <= 0) this.gameOver('稳定度归零，空间站陷入混乱！');
  }

  /* ================= 突发事件 ================= */

  triggerEvent() {
    const types = ['leak', 'pirate', 'damage'].filter(t => t !== this.lastEvent);
    const type = pick(types);
    this.lastEvent = type;
    const st = this.state;
    if (type === 'leak') {
      st.crisis = { type: 'leak' };
      st.leak = true;
      this.addLog('⚠ 警报：货舱氧气泄漏！请立即修复', '#ff8a80');
    } else if (type === 'pirate') {
      st.crisis = { type: 'pirate', timeLeft: 9 };
      this.addLog('☠ 警报：海盗逼近！9 秒后劫掠甲板', '#ff8a80');
    } else {
      const idx = randInt(0, st.bays.length - 1);
      st.bays[idx].damagedUntil = st.time + 20;
      st.crisis = { type: 'damage', bay: idx };
      this.addLog(`🔧 舱位 ${bayName(idx, this.cfg.bayCols)} 受损，暂停使用！`, '#ff8a80');
      this.renderBay(idx);
    }
    Sfx.alarm();
    this.cameras.main.shake(200, 0.005);
    this.renderBanner();
  }

  tickCrisis(dt) {
    const c = this.state.crisis;
    if (!c) return;
    if (c.type === 'pirate') {
      c.timeLeft -= dt;
      if (c.timeLeft <= 0) this.pirateStrike();
    } else if (c.type === 'damage') {
      if (this.state.time >= this.state.bays[c.bay].damagedUntil) {
        this.endCrisis(`舱位 ${bayName(c.bay, this.cfg.bayCols)} 已自动修复`);
      }
    }
    // 泄漏持续到玩家修复为止
  }

  endCrisis(msg) {
    if (msg) this.addLog(msg, '#9dff9d');
    this.state.crisis = null;
    this.eventTimer = rand(this.cfg.eventInterval[0], this.cfg.eventInterval[1]);
    this.renderBanner();
  }

  pirateStrike() {
    const st = this.state;
    let stolen = 0;
    for (let n = 0; n < 2; n++) {
      const candidates = [];
      st.bays.forEach((b, bi) => b.containers.forEach((c, ci) => candidates.push([bi, ci])));
      if (!candidates.length) break;
      const [bi, ci] = pick(candidates);
      const c = st.bays[bi].containers.splice(ci, 1)[0];
      stolen++;
      this.stats.stolen++;
      this.addLog(`☠ 海盗掠走了 ${cargoName(c)}（舱位 ${bayName(bi, this.cfg.bayCols)}）`, '#ff8a80');
    }
    if (!stolen) this.addLog('海盗扑了个空', '#9fb7cc');
    st.stability = Math.max(0, st.stability - 8);
    Sfx.error();
    this.cameras.main.shake(300, 0.008);
    this.endCrisis();
    this.renderAll();
    if (st.stability <= 0) this.gameOver('稳定度归零，空间站陷入混乱！');
  }

  defend() {
    if (!this.state.crisis || this.state.crisis.type !== 'pirate') return;
    if (!this.hasFuel(COST.DEFEND)) return;
    this.state.fuel -= COST.DEFEND;
    this.state.stability = Math.min(100, this.state.stability + 2);
    this.addLog('🛡 防御炮台击退海盗！稳定度 +2', '#9dff9d');
    Sfx.success();
    this.endCrisis();
  }

  repairLeak() {
    if (!this.state.crisis || this.state.crisis.type !== 'leak') return;
    if (!this.hasFuel(COST.REPAIR_LEAK)) return;
    this.state.fuel -= COST.REPAIR_LEAK;
    this.state.leak = false;
    this.addLog('🔧 泄漏已修复，氧气恢复中', '#9dff9d');
    Sfx.place();
    this.endCrisis();
  }

  repairBay() {
    const c = this.state.crisis;
    if (!c || c.type !== 'damage') return;
    if (!this.hasFuel(COST.REPAIR_BAY)) return;
    this.state.fuel -= COST.REPAIR_BAY;
    this.state.bays[c.bay].damagedUntil = 0;
    this.addLog(`🔧 舱位 ${bayName(c.bay, this.cfg.bayCols)} 修复完成`, '#9dff9d');
    Sfx.place();
    this.endCrisis();
    this.renderBay(c.bay);
  }

  /* ================= 辅助 ================= */

  totalDeckWeight() { return this.state.bays.reduce((s, b) => s + bayWeight(b), 0); }
  deckLoadRatio() { return this.totalDeckWeight() / (this.state.bays.length * BAY_MAX_WEIGHT); }

  togglePause() {
    if (this.state.gameOver || this.intro) return;
    this.state.paused = !this.state.paused;
    this.pauseOverlay.setVisible(this.state.paused);
    this.ui.pauseBtn.setLabel(this.state.paused ? '▶ 继续' : '⏸ 暂停');
    Sfx.click();
  }

  gameOver(reason) {
    const st = this.state;
    if (st.gameOver) return;
    st.gameOver = true;
    Sfx.alarm();

    let prev, isRec;
    if (this.contractMode) {
      clearContractRun(this.cfg.key);
      const best = loadBestContracts();
      prev = best[this.cfg.key] || 0;
      isRec = this.earnings.base + this.earnings.market + this.earnings.time > prev;
      if (isRec) {
        best[this.cfg.key] = this.earnings.base + this.earnings.market + this.earnings.time;
        saveBestContracts(best);
      }
    } else {
      const best = loadBest();
      prev = best[this.cfg.key] || 0;
      isRec = st.score > prev;
      if (isRec) { best[this.cfg.key] = st.score; saveBest(best); }
    }

    const ov = this.add.container(0, 0).setDepth(100);
    const dim = this.add.rectangle(0, 0, 1280, 720, 0x000000, 0.72).setOrigin(0).setInteractive();
    const panel = this.add.rectangle(640, 360, 520, 470, 0x101c2b).setStrokeStyle(2, 0xff5252);
    ov.add([dim, panel]);
    ov.add(this.add.text(640, 168, '航 线 终 止', TS(36, '#ff8a80', { fontStyle: 'bold' })).setOrigin(0.5));
    ov.add(this.add.text(640, 212, reason, TS(14, '#ffb0a8')).setOrigin(0.5));
    if (isRec) ov.add(this.add.text(640, 244, '🏆 新纪录！', TS(20, '#ffd24a', { fontStyle: 'bold' })).setOrigin(0.5));
    let lines;
    if (this.contractMode) {
      const tot = this.earnings.base + this.earnings.market + this.earnings.time;
      lines = [
        `最终得分：${st.score}`,
        `合同结算合计：${tot}`,
        `合同 完成 ${this.stats.contractDone} / 逾期 ${this.stats.contractExpired}`,
        `装货订单：${this.stats.done} · 卸货：${this.stats.unloaded}`,
        `错失船只：${this.stats.missed} · 被掠：${this.stats.stolen}`,
        `存活时间：${fmtTime(st.time)}`,
        `最佳合同收益：${Math.max(prev, tot)}`,
      ].join('\n');
    } else {
      lines = [
        `最终得分：${st.score}`,
        `历史最高：${Math.max(prev, st.score)}`,
        `完成订单：${this.stats.done}`,
        `卸货完成：${this.stats.unloaded}`,
        `错失船只：${this.stats.missed}`,
        `被掠货物：${this.stats.stolen}`,
        `存活时间：${fmtTime(st.time)}`,
      ].join('\n');
    }
    ov.add(this.add.text(640, isRec ? 340 : 328, lines, TS(15, '#cfe6f5', { align: 'center', lineSpacing: 9 })).setOrigin(0.5));
    ov.add(makeButton(this, 550, 520, 150, 40, '🔁 再来一局',
      () => this.scene.restart(this.contractMode ? { difficulty: this.diffIndex, mode: 'contract', fresh: true } : { difficulty: this.diffIndex }),
      { fontSize: 15 }));
    ov.add(makeButton(this, 730, 520, 150, 40, '返回菜单', () => this.scene.start('MenuScene'), { fontSize: 15 }));
  }

  /* ================= 合同模式：合同生成与接取 ================= */

  generateContracts() {
    const cc = CONTRACT_CFG[this.cfg.key];
    const dests = Phaser.Utils.Array.Shuffle([...DESTINATIONS]).slice(0, 3);
    return dests.map(dest => {
      const req = genCargoCombo(cc.units, cc.types);
      const total = CARGO_KEYS.reduce((s, k) => s + req[k], 0);
      const deadline = Math.round(this.state.time + rand(cc.deadline[0], cc.deadline[1]));
      const mult = Math.round(rand(cc.mult[0] * 10, cc.mult[1] * 10)) / 10;
      return {
        id: this.contractSeq++,
        dest, req, total,
        deadline, mult,
        status: 'offered',                       // offered | active | done | expired
        done: { ore: 0, energy: 0, supply: 0 },
        baseEarn: 0, marketEarn: 0, timeEarn: 0,
      };
    });
  }

  showContractOffer() {
    const offers = this.generateContracts();
    this.contracts = offers;
    const selected = new Set();

    const ov = this.add.container(0, 0).setDepth(90);
    const dim = this.add.rectangle(0, 0, 1280, 720, 0x000000, 0.78).setOrigin(0).setInteractive();
    const panel = this.add.rectangle(640, 330, 1080, 560, 0x101c2b).setStrokeStyle(2, 0x7fe3ff);
    ov.add([dim, panel]);
    ov.add(this.add.text(640, 74, '📜 航 线 合 同', TS(30, '#7fe3ff', { fontStyle: 'bold' })).setOrigin(0.5));
    ov.add(this.add.text(640, 112, `本航次公开 3 份合同，请接取 1～${CONTRACT_MAX_ACCEPT} 份（点击卡片选择 / 取消）`, TS(14, '#9fb7cc')).setOrigin(0.5));

    const cw = 320, ch = 360, gap = 30;
    const x0 = 640 - (3 * cw + 2 * gap) / 2;
    const cards = offers.map((c, i) => {
      const cx = x0 + i * (cw + gap) + cw / 2, cy = 330;
      const card = this.add.container(cx, cy);
      const bg = this.add.rectangle(0, 0, cw, ch, 0x14202e).setStrokeStyle(2, 0x2c4258);
      const lines = [
        `目的地：${c.dest}`,
        `货物：${comboText(c.req)}（共 ${c.total} 件）`,
        `截止：${fmtTime(c.deadline)} 前完成`,
        `奖励倍率：×${c.mult.toFixed(1)}`,
        `基准货值：${contractBaseValue(c.req)}`,
      ].join('\n');
      const t = this.add.text(0, -70, lines, TS(14, '#dff3ff', { align: 'center', lineSpacing: 14 })).setOrigin(0.5);
      const mark = this.add.text(0, ch / 2 - 40, '', TS(16, '#9dff9d', { fontStyle: 'bold' })).setOrigin(0.5);
      card.add([bg, t, mark]);
      ov.add(card);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => {
        Sfx.click();
        if (selected.has(i)) { selected.delete(i); }
        else {
          if (selected.size >= CONTRACT_MAX_ACCEPT) { this.addLog(`最多同时接取 ${CONTRACT_MAX_ACCEPT} 份合同`, '#ff8a80'); Sfx.error(); return; }
          selected.add(i);
        }
        refreshCards();
      });
      return { bg, mark };
    });

    const tip = this.add.text(640, 500, '', TS(13, '#ffd24a')).setOrigin(0.5);
    const startBtn = makeButton(this, 640, 560, 220, 42, '接取所选并开工', () => {
      if (!selected.size) { Sfx.error(); return; }
      offers.forEach((c, i) => { c.status = selected.has(i) ? 'active' : 'skipped'; });
      this.contracts = offers.filter(c => c.status === 'active');
      ov.destroy();
      this.intro = false;
      this.addLog(`📜 已接取 ${this.contracts.length} 份合同，按目的地与货物组合安排装货`, '#c79fff');
      this.addLog('行情每 60 秒波动一次，高价时交货收益更丰', '#9fb7cc');
      Sfx.success();
      this.renderAll();
      this.saveRun();
    }, { fontSize: 15, bg: 0x1b3a52, hover: 0x274d6e, stroke: 0x7fe3ff });
    ov.add([startBtn, tip]);

    const refreshCards = () => {
      cards.forEach((card, i) => {
        const on = selected.has(i);
        card.bg.setFillStyle(on ? 0x1d3326 : 0x14202e).setStrokeStyle(2, on ? 0x7dd87d : 0x2c4258);
        card.mark.setText(on ? '✔ 已选择' : '');
      });
      tip.setText(selected.size ? `已选择 ${selected.size} 份合同（最多 ${CONTRACT_MAX_ACCEPT} 份）` : '请至少选择 1 份合同');
    };
    refreshCards();
  }

  /* ================= 合同模式：市场与合同计时 ================= */

  tickContracts(dt) {
    // 行情波动
    this.market.timer -= dt;
    if (this.market.timer <= 0) {
      this.market.timer = MARKET.interval;
      this.fluctuateMarket();
    }
    // 合同逾期
    let changed = false;
    this.contracts.forEach(c => {
      if (c.status === 'active' && this.state.time >= c.deadline) {
        c.status = 'expired';
        changed = true;
        this.stats.contractExpired++;
        const pen = CONTRACT_CFG[this.cfg.key].penalty;
        this.state.stability = Math.max(0, this.state.stability - pen);
        this.addLog(`⏰ 合同 [${c.id}] 前往${c.dest}逾期！稳定度 -${pen}`, '#ff8a80');
        Sfx.error();
        this.cameras.main.shake(150, 0.004);
        this.renderBanner();
      }
    });
    if (changed) {
      this.renderAll();
      this.saveRun();
      if (this.state.stability <= 0) { this.gameOver('稳定度归零，空间站陷入混乱！'); return; }
      this.checkAllContractsResolved();
    }
  }

  fluctuateMarket() {
    this.market.last = { ...this.market.prices };
    CARGO_KEYS.forEach(k => {
      const f = 1 + rand(-MARKET.swing, MARKET.swing);
      const p = Math.round(clamp(this.market.prices[k] * f, MARKET.min[k], MARKET.max[k]));
      this.market.prices[k] = p;
    });
    const parts = CARGO_KEYS.map(k => `${CARGO_TYPES[k].short}${this.market.prices[k]}`);
    this.addLog(`📈 市场行情波动：${parts.join(' / ')}`, '#7fe3ff');
    Sfx.click();
  }

  /* ================= 合同模式：订单结算 ================= */

  settleLoaderContract(ship, fx, fy) {
    const st = this.state;
    let reqTotal = 0, fulfilled = 0;
    CARGO_KEYS.forEach(k => {
      const req = ship.requires[k] || 0;
      reqTotal += req;
      fulfilled += Math.min(ship.loaded[k], req);
    });

    if (fulfilled < reqTotal || reqTotal === 0) {
      // 订单未完成：同经典规则扣稳定度，不结算合同
      if (fulfilled > 0) {
        st.stability = Math.max(0, st.stability - 5);
        this.stats.missed++;
        this.addLog(`⚠ 前往${ship.dest || '未知'}订单未完成（${fulfilled}/${reqTotal}）离港，稳定度 -5`, '#ffb74d');
      } else {
        st.stability = Math.max(0, st.stability - 8);
        this.stats.missed++;
        this.addLog(`❌ ${truncate(ship.name, 12)} 空船离港！稳定度 -8`, '#ff8a80');
        this.cameras.main.shake(150, 0.004);
      }
      Sfx.error();
      return;
    }

    // 按当前行情计算货物收益
    let baseAtBase = 0, atMarket = 0;
    CARGO_KEYS.forEach(k => {
      const n = Math.min(ship.loaded[k], ship.requires[k] || 0);
      baseAtBase += n * MARKET.base[k];
      atMarket += n * this.market.prices[k];
    });

    let ctr = null;
    if (ship.contractId != null) ctr = this.contracts.find(c => c.id === ship.contractId && c.status === 'active');
    // 目的地匹配的在执行合同同样可结算（即使该船不是为合同生成的）
    if (!ctr && ship.dest) ctr = this.contracts.find(c => c.status === 'active' && c.dest === ship.dest);

    const mult = ctr ? ctr.mult : 1;
    const marketBonus = Math.round((atMarket - baseAtBase) * mult);
    const baseEarn = Math.round(baseAtBase * mult);
    const timeBonus = Math.max(0, Math.ceil(ship.timeLeft));
    const gain = baseEarn + marketBonus + timeBonus;

    st.score += gain;
    st.fuel = Math.min(FUEL_MAX, st.fuel + 8);
    st.stability = Math.min(100, st.stability + 4);
    this.stats.done++;
    this.earnings.base += baseEarn;
    this.earnings.market += marketBonus;
    this.earnings.time += timeBonus;
    this.earnings.fuel += 8;

    if (ctr) {
      CARGO_KEYS.forEach(k => { ctr.done[k] += Math.min(ship.loaded[k], ship.requires[k] || 0); });
      ctr.baseEarn += baseEarn; ctr.marketEarn += marketBonus; ctr.timeEarn += timeBonus;
      this.addLog(
        `✅ 合同[${ctr.id}] ${ship.dest} 交货 +${gain}（基础${baseEarn} 行情${marketBonus >= 0 ? '+' : ''}${marketBonus} 时间+${timeBonus}）+8燃料`,
        '#9dff9d');
      this.floatText(fx, fy, '+' + gain, '#c79fff');
      const complete = CARGO_KEYS.every(k => ctr.done[k] >= ctr.req[k]);
      if (complete) {
        ctr.status = 'done';
        this.stats.contractDone++;
        this.addLog(`🏁 合同 [${ctr.id}] 前往${ctr.dest}已全部完成！`, '#ffd24a');
      }
    } else {
      this.addLog(
        `✅ 前往${ship.dest || '未知'}散单 +${gain}（基础${baseEarn} 行情${marketBonus >= 0 ? '+' : ''}${marketBonus} 时间+${timeBonus}）+8燃料`,
        '#9dff9d');
      this.floatText(fx, fy, '+' + gain, '#ffd24a');
    }
    Sfx.success();
    this.saveRun();
    if (ctr) this.checkAllContractsResolved();
  }

  checkAllContractsResolved() {
    if (this.state.gameOver) return;
    const pending = this.contracts.filter(c => c.status === 'active').length;
    if (pending > 0) return;
    // 全部合同已结束（完成或逾期）→ 结算界面
    this.state.gameOver = true;
    this.showContractSettlement();
  }

  showContractSettlement() {
    const st = this.state;
    clearContractRun(this.cfg.key);
    const total = this.earnings.base + this.earnings.market + this.earnings.time;
    const best = loadBestContracts();
    const prev = best[this.cfg.key] || 0;
    const isRec = total > prev;
    if (isRec) { best[this.cfg.key] = total; saveBestContracts(best); }

    const ov = this.add.container(0, 0).setDepth(100);
    const dim = this.add.rectangle(0, 0, 1280, 720, 0x000000, 0.75).setOrigin(0).setInteractive();
    const panel = this.add.rectangle(640, 360, 600, 540, 0x101c2b).setStrokeStyle(2, 0x7dd87d);
    ov.add([dim, panel]);
    ov.add(this.add.text(640, 120, '📜 合 同 结 算', TS(34, '#7fe3ff', { fontStyle: 'bold' })).setOrigin(0.5));
    ov.add(this.add.text(640, 160, `${this.cfg.name} · 全部合同已结束`, TS(14, '#9fb7cc')).setOrigin(0.5));
    if (isRec) ov.add(this.add.text(640, 188, '🏆 最佳合同收益新纪录！', TS(18, '#ffd24a', { fontStyle: 'bold' })).setOrigin(0.5));

    // 每份合同明细
    const detail = this.contracts.map(c => {
      const sum = c.baseEarn + c.marketEarn + c.timeEarn;
      const tag = c.status === 'done' ? '✔完成' : '⏰逾期';
      return `[${c.id}] ${truncate(c.dest, 7)} ×${c.mult.toFixed(1)} ${tag}  收益 ${sum}`;
    }).join('\n');
    ov.add(this.add.text(640, 250, detail, TS(13, '#cfe6f5', { align: 'center', lineSpacing: 10 })).setOrigin(0.5));

    const lines = [
      `基础收益（含倍率）：${this.earnings.base}`,
      `行情加成：${this.earnings.market >= 0 ? '+' : ''}${this.earnings.market}`,
      `时间奖励：${this.earnings.time}`,
      `合同结算合计：${total}`,
      `其他得分（卸货等）：${Math.max(0, st.score - total)}`,
      `最终总分：${st.score}`,
      `完成 ${this.stats.contractDone} 份 · 逾期 ${this.stats.contractExpired} 份 · 用时 ${fmtTime(st.time)}`,
      `历史最佳合同收益：${Math.max(prev, total)}`,
    ].join('\n');
    ov.add(this.add.text(640, 410, lines, TS(15, '#dff3ff', { align: 'center', lineSpacing: 10 })).setOrigin(0.5));
    ov.add(makeButton(this, 540, 580, 180, 42, '🔁 再来一局',
      () => this.scene.restart({ difficulty: this.diffIndex, mode: 'contract', fresh: true }), { fontSize: 15 }));
    ov.add(makeButton(this, 740, 580, 180, 42, '返回菜单', () => this.scene.start('MenuScene'), { fontSize: 15 }));
    Sfx.success();
  }

  /* ================= 合同模式：存档 / 续局 ================= */

  serializeShip(sh) {
    return {
      id: sh.id, kind: sh.kind, name: sh.name,
      cargo: sh.cargo.map(c => ({ ...c })),
      loadedContainers: sh.loadedContainers.map(c => ({ ...c })),
      loaded: { ...sh.loaded }, requires: sh.requires ? { ...sh.requires } : null,
      eta: sh.eta, timeLeft: sh.timeLeft, totalTime: sh.totalTime,
      dest: sh.dest || null, contractId: sh.contractId != null ? sh.contractId : null,
    };
  }

  saveRun() {
    if (!this.contractMode || this.intro) return;
    const st = this.state;
    if (st.gameOver) { clearContractRun(this.cfg.key); return; }
    try {
      const data = {
        v: 1, diffIndex: this.diffIndex, savedAt: Date.now(),
        state: {
          time: st.time, score: st.score, fuel: st.fuel, stability: st.stability, oxygen: st.oxygen,
          leak: st.leak,
          bays: st.bays.map(b => ({ containers: b.containers.map(c => ({ ...c })), damagedUntil: b.damagedUntil })),
          docks: st.docks.map(sh => sh ? this.serializeShip(sh) : null),
          queue: st.queue.map(sh => this.serializeShip(sh)),
        },
        seqs: { container: this.containerSeq, ship: this.shipSeq, contract: this.contractSeq },
        contracts: this.contracts.map(c => ({ ...c, req: { ...c.req }, done: { ...c.done } })),
        market: { prices: { ...this.market.prices }, last: { ...this.market.last }, timer: this.market.timer },
        earnings: { ...this.earnings },
        stats: { ...this.stats },
        timers: { spawn: this.spawnTimer, event: this.eventTimer, save: this.saveTimer },
        lastEvent: this.lastEvent,
        crisis: st.crisis ? { ...st.crisis } : null,
      };
      saveContractRun(this.cfg.key, data);
    } catch (e) { /* ignore */ }
  }

  restoreShip(d) {
    return {
      id: d.id, kind: d.kind, name: d.name,
      cargo: d.cargo.map(c => ({ ...c })),
      loadedContainers: d.loadedContainers.map(c => ({ ...c })),
      loaded: { ...d.loaded }, requires: d.requires ? { ...d.requires } : null,
      eta: d.eta, timeLeft: d.timeLeft, totalTime: d.totalTime,
      dest: d.dest || null, contractId: d.contractId != null ? d.contractId : null,
    };
  }

  restoreRun(data) {
    const st = this.state, s = data.state;
    st.time = s.time; st.score = s.score; st.fuel = s.fuel;
    st.stability = s.stability; st.oxygen = s.oxygen; st.leak = s.leak;
    st.bays = s.bays.map(b => ({ containers: b.containers.map(c => ({ ...c })), damagedUntil: b.damagedUntil }));
    st.docks = s.docks.map(d => d ? this.restoreShip(d) : null);
    st.queue = s.queue.map(d => this.restoreShip(d));
    st.crisis = data.crisis || null;

    this.containerSeq = data.seqs.container;
    this.shipSeq = data.seqs.ship;
    this.contractSeq = data.seqs.contract;
    this.contracts = data.contracts.map(c => ({ ...c, req: { ...c.req }, done: { ...c.done } }));
    this.market = { prices: { ...data.market.prices }, last: { ...data.market.last }, timer: data.market.timer };
    this.earnings = { ...data.earnings };
    this.stats = Object.assign({ done: 0, unloaded: 0, missed: 0, stolen: 0, contractDone: 0, contractExpired: 0 }, data.stats);
    this.spawnTimer = data.timers.spawn;
    this.eventTimer = data.timers.event;
    this.saveTimer = data.timers.save || 0;
    this.lastEvent = data.lastEvent || null;
    if (data.crisis) {
      st.crisis = { ...data.crisis };
      if (st.crisis.type === 'pirate' && st.crisis.timeLeft == null) st.crisis.timeLeft = 9;
    } else if (st.leak) st.crisis = { type: 'leak' };
    this.intro = false;
  }
}
