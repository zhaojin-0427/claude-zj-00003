/* =========================================================
 * 启动入口
 * ========================================================= */
window.addEventListener('load', () => {
  window.__game = new Phaser.Game({
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    parent: 'game',
    backgroundColor: '#060b14',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [MenuScene, GameScene],
  });
});
