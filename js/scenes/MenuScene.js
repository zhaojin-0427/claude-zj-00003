/* =========================================================
 * 主菜单场景：标题 / 航线（难度）选择 / 玩法说明 / 历史最高分
 * ========================================================= */
class MenuScene extends Phaser.Scene {
  constructor() { super('MenuScene'); }

  create() {
    drawStars(this);

    this.add.text(640, 96, '星 际 运 输 站', TS(54, '#7fe3ff', { fontStyle: 'bold' })).setOrigin(0.5);
    this.add.text(640, 148, '—— 货运甲板资源调配策略 ——', TS(18, '#9fb7cc')).setOrigin(0.5);

    // 航线（难度）卡片
    const best = loadBest();
    const cw = 340, ch = 212, gap = 36;
    const x0 = (1280 - (cw * 3 + gap * 2)) / 2, y = 196;
    DIFFICULTIES.forEach((d, i) => {
      const x = x0 + i * (cw + gap);
      const card = this.add.container(x + cw / 2, y + ch / 2);
      const bg = this.add.rectangle(0, 0, cw, ch, 0x101c2b).setStrokeStyle(2, 0x2c4258);
      const name = this.add.text(0, -ch / 2 + 30, d.name, TS(24, '#dff3ff', { fontStyle: 'bold' })).setOrigin(0.5);
      const stars = this.add.text(0, -ch / 2 + 62, d.stars, TS(17, '#ffd24a')).setOrigin(0.5);
      // 说明文字：useAdvancedWrap 按字符断行（基础换行只在空格处断行，中文会溢出）
      const desc = this.add.text(0, -ch / 2 + 84, d.desc, TS(13, '#7d93a8', {
        wordWrap: { width: cw - 44, useAdvancedWrap: true },
        align: 'center',
        lineSpacing: 4,
      })).setOrigin(0.5, 0);
      const b = best[d.key] || 0;
      const bestT = this.add.text(0, ch / 2 - 54, `历史最高：${b}`, TS(14, b > 0 ? '#ffd24a' : '#4a6076')).setOrigin(0.5);
      const go = this.add.text(0, ch / 2 - 24, '▶ 点击启航', TS(15, '#7fe3ff')).setOrigin(0.5);
      card.add([bg, name, stars, desc, bestT, go]);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => { bg.setStrokeStyle(2, 0x7fe3ff); card.setScale(1.03); });
      bg.on('pointerout', () => { bg.setStrokeStyle(2, 0x2c4258); card.setScale(1); });
      bg.on('pointerdown', () => { Sfx.click(); this.scene.start('GameScene', { difficulty: i }); });
    });

    // 玩法说明
    const py = 452;
    this.add.rectangle(640, py + 92, 1100, 176, 0x0d1622).setStrokeStyle(1, 0x22364a);
    const help = [
      '【玩法】卸货船靠港后，将货物搬入舱位；在倒计时结束前为装货船集齐需求货物，完成订单赚取分数与燃料。',
      '【操作】点击货物选择 → 点击舱位 / 装货船面板放置；点击同类货物合并（最多 3 件）；选中后可拆分；右键取消。',
      '【策略】舱位有堆叠与载重上限，搬运消耗燃料；卸货船可向装货船优先直转（燃料×2）；超载会拉低稳定度。',
      '【危机】氧气泄漏、货舱损坏、海盗袭击需及时应对；稳定度归零则空间站瘫痪。空格暂停规划 · Z 撤销 · M 静音。',
    ].join('\n');
    this.add.text(640, py + 92, help, TS(14, '#9fb7cc', { lineSpacing: 12 })).setOrigin(0.5);

    this.add.text(640, 694, 'Powered by Phaser 3 · 高分保存在本地 localStorage', TS(12, '#3d5468')).setOrigin(0.5);
  }
}
