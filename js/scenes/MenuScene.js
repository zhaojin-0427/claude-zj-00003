/* =========================================================
 * 主菜单场景：模式选择 / 航线（难度）选择 / 玩法说明 / 最高分
 *  - 经典模式：原有玩法（存档与规则完全不变）
 *  - 合同模式：航线合同 + 动态市场（支持刷新后继续）
 * ========================================================= */
class MenuScene extends Phaser.Scene {
  constructor() { super('MenuScene'); }

  create() {
    drawStars(this);
    this.mode = 'classic';
    this.contractSaves = loadContractSaves();

    this.add.text(640, 70, '星 际 运 输 站', TS(46, '#7fe3ff', { fontStyle: 'bold' })).setOrigin(0.5);
    this.add.text(640, 112, '—— 货运甲板资源调配策略 ——', TS(16, '#9fb7cc')).setOrigin(0.5);

    // 模式切换标签
    this.tabClassic = this.makeTab(540, '⚙ 经典模式');
    this.tabContract = this.makeTab(740, '📜 合同模式');
    this.tabClassic.bg.on('pointerdown', () => { Sfx.click(); this.setMode('classic'); });
    this.tabContract.bg.on('pointerdown', () => { Sfx.click(); this.setMode('contract'); });

    // 航线卡片容器（切换模式时重建）
    this.cardsLayer = this.add.container(0, 0);
    this.helpLayer = this.add.container(0, 0);

    this.setMode('classic');

    this.add.text(640, 700, 'Powered by Phaser 3 · 高分与合同进度保存在本地 localStorage', TS(12, '#3d5468')).setOrigin(0.5);
  }

  makeTab(cx, label) {
    const w = 180, h = 34;
    const c = this.add.container(cx, 148);
    const bg = this.add.rectangle(0, 0, w, h, 0x101c2b).setStrokeStyle(2, 0x2c4258);
    const t = this.add.text(0, 0, label, TS(15, '#9fb7cc')).setOrigin(0.5);
    bg.setInteractive({ useHandCursor: true });
    c.add([bg, t]);
    return { bg, t };
  }

  setMode(mode) {
    this.mode = mode;
    const active = { fill: 0x1b3a52, stroke: 0x7fe3ff, color: '#7fe3ff' };
    const idle = { fill: 0x101c2b, stroke: 0x2c4258, color: '#9fb7cc' };
    [ [this.tabClassic, 'classic'], [this.tabContract, 'contract'] ].forEach(([tab, m]) => {
      const s = mode === m ? active : idle;
      tab.bg.setFillStyle(s.fill).setStrokeStyle(2, s.stroke);
      tab.t.setColor(s.color);
    });
    this.buildCards();
    this.buildHelp();
  }

  buildCards() {
    this.cardsLayer.removeAll(true);
    const bestClassic = loadBest();
    const bestContract = loadBestContracts();
    const contract = this.mode === 'contract';
    const cw = 320, ch = 236, gap = 30;
    const x0 = (1280 - (cw * 3 + gap * 2)) / 2, y = 180;
    DIFFICULTIES.forEach((d, i) => {
      const x = x0 + i * (cw + gap);
      const card = this.add.container(x + cw / 2, y + ch / 2);
      const bg = this.add.rectangle(0, 0, cw, ch, 0x101c2b).setStrokeStyle(2, 0x2c4258);
      const name = this.add.text(0, -ch / 2 + 26, d.name, TS(22, '#dff3ff', { fontStyle: 'bold' })).setOrigin(0.5);
      const stars = this.add.text(0, -ch / 2 + 54, d.stars, TS(15, '#ffd24a')).setOrigin(0.5);
      const desc = this.add.text(0, -ch / 2 + 74, d.desc, TS(12, '#7d93a8', {
        wordWrap: { width: cw - 40, useAdvancedWrap: true },
        align: 'center', lineSpacing: 3,
      })).setOrigin(0.5, 0);

      const save = contract ? this.contractSaves[d.key] : null;
      let bestLine, bestColor;
      if (contract) {
        const bp = bestContract[d.key] || 0;
        bestLine = `最佳合同收益：${bp}`;
        bestColor = bp > 0 ? '#ffd24a' : '#4a6076';
      } else {
        const b = bestClassic[d.key] || 0;
        bestLine = `历史最高：${b}`;
        bestColor = b > 0 ? '#ffd24a' : '#4a6076';
      }
      const bestT = this.add.text(0, ch / 2 - 74, bestLine, TS(13, bestColor)).setOrigin(0.5);

      const go = this.add.text(0, ch / 2 - 22, contract ? '📜 新开合同局' : '▶ 点击启航', TS(14, '#7fe3ff')).setOrigin(0.5);
      card.add([bg, name, stars, desc, bestT, go]);

      // 继续未结束合同局
      if (save) {
        const resume = this.add.text(0, ch / 2 - 48, `↩ 继续未结束合同局（${fmtTime(save.state.time)}）`, TS(12, '#9dff9d')).setOrigin(0.5);
        card.add(resume);
        resume.setInteractive({ useHandCursor: true });
        resume.on('pointerover', () => resume.setColor('#d6ffe0'));
        resume.on('pointerout', () => resume.setColor('#9dff9d'));
        resume.on('pointerdown', () => {
          Sfx.click();
          this.scene.start('GameScene', { difficulty: i, mode: 'contract', resume: true });
        });
      }

      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => { bg.setStrokeStyle(2, 0x7fe3ff); card.setScale(1.03); });
      bg.on('pointerout', () => { bg.setStrokeStyle(2, 0x2c4258); card.setScale(1); });
      bg.on('pointerdown', () => {
        Sfx.click();
        if (contract) this.scene.start('GameScene', { difficulty: i, mode: 'contract', fresh: true });
        else this.scene.start('GameScene', { difficulty: i });
      });
      this.cardsLayer.add(card);
    });
  }

  buildHelp() {
    this.helpLayer.removeAll(true);
    const py = 446;
    const box = this.add.rectangle(640, py + 92, 1100, 176, 0x0d1622).setStrokeStyle(1, 0x22364a);
    let help;
    if (this.mode === 'contract') {
      help = [
        '【合同】每局随机生成 3 份合同（目标目的地 + 货物组合 + 完成数量 + 截止时间 + 奖励倍率），最多同时接取 2 份。',
        '【市场】矿石 / 能源 / 补给价格每 60 秒波动一次；装货订单按目的地匹配合同，并以当前行情结算收益与燃料。',
        '【结算】完成合同可获得基础收益（含倍率）、行情加成与时间奖励；全部合同结束后展示结算界面。',
        '【风险】逾期未完成的合同将扣除稳定度；合同进度自动保存，刷新页面可继续 — 经典模式玩法与存档不受影响。',
      ].join('\n');
    } else {
      help = [
        '【玩法】卸货船靠港后，将货物搬入舱位；在倒计时结束前为装货船集齐需求货物，完成订单赚取分数与燃料。',
        '【操作】点击货物选择 → 点击舱位 / 装货船面板放置；点击同类货物合并（最多 3 件）；选中后可拆分；右键取消。',
        '【策略】舱位有堆叠与载重上限，搬运消耗燃料；卸货船可向装货船优先直转（燃料×2）；超载会拉低稳定度。',
        '【危机】氧气泄漏、货舱损坏、海盗袭击需及时应对；稳定度归零则空间站瘫痪。空格暂停规划 · Z 撤销 · M 静音。',
      ].join('\n');
    }
    const t = this.add.text(640, py + 92, help, TS(13, '#9fb7cc', { lineSpacing: 12 })).setOrigin(0.5);
    this.helpLayer.add([box, t]);
  }
}
