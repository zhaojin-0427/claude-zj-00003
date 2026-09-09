/* =========================================================
 * 星际运输站 · 资源调配策略 —— 全局配置与静态数据
 * ========================================================= */

// 货物类型：矿石（重） / 能源（中） / 补给（轻）
const CARGO_TYPES = {
  ore:    { key: 'ore',    name: '矿石', short: '矿', color: 0xc08a4e, textColor: '#2a1a08', weight: 3, value: 30 },
  energy: { key: 'energy', name: '能源', short: '能', color: 0xffd24a, textColor: '#3a2c00', weight: 2, value: 20 },
  supply: { key: 'supply', name: '补给', short: '补', color: 0x63d68d, textColor: '#06301a', weight: 1, value: 10 },
};
const CARGO_KEYS = ['ore', 'energy', 'supply'];

// 舱位限制
const BAY_MAX_STACK  = 3;   // 每个舱位最多堆 3 箱
const BAY_MAX_WEIGHT = 9;   // 每个舱位最大载重
const FUEL_MAX       = 99;  // 燃料上限

// 操作燃料消耗
const COST = { MOVE: 1, MERGE: 2, SPLIT: 1, DIRECT: 2, REPAIR_LEAK: 3, REPAIR_BAY: 2, DEFEND: 5 };

// 三条难度递进的星系航线
const DIFFICULTIES = [
  {
    key: 'centauri', name: '半人马座航线', stars: '★☆☆',
    desc: '新手航线：泊位与舱位充裕，船只时限宽松，突发事件稀少。适合熟悉调度节奏。',
    docks: 2, bays: 12, bayCols: 4,
    startFuel: 55, fuelRegen: 0.40,
    spawnInterval: [12, 18],        // 新船生成间隔（秒）
    shipTime: [55, 75],             // 船只停靠时限（秒）
    unloadCount: [2, 3],            // 卸货船载货箱数
    reqUnits: [2, 4],               // 装货船需求总件数
    reqTypes: [1, 2],               // 需求货物种类数
    unloaderRatio: 0.45,            // 卸货船占比
    eventInterval: [38, 55],        // 突发事件间隔（秒）
  },
  {
    key: 'sirius', name: '天狼星航线', stars: '★★☆',
    desc: '标准航线：到港节奏加快，订单需求更复杂，泄漏与海盗时有发生。',
    docks: 2, bays: 10, bayCols: 5,
    startFuel: 45, fuelRegen: 0.35,
    spawnInterval: [9, 14],
    shipTime: [45, 62],
    unloadCount: [2, 4],
    reqUnits: [3, 5],
    reqTypes: [1, 3],
    unloaderRatio: 0.45,
    eventInterval: [26, 40],
  },
  {
    key: 'core', name: '银河核心航线', stars: '★★★',
    desc: '困难航线：三个泊位高频到港，时限紧迫，危机频发。唯有老练的调度官才能生存。',
    docks: 3, bays: 10, bayCols: 5,
    startFuel: 40, fuelRegen: 0.30,
    spawnInterval: [7, 11],
    shipTime: [38, 55],
    unloadCount: [3, 4],
    reqUnits: [3, 6],
    reqTypes: [2, 3],
    unloaderRatio: 0.5,
    eventInterval: [18, 28],
  },
];

// 船名与目的地（风味文本）
const SHIP_NAMES = ['天狼星号', '织女一号', '北斗快航', '猎户之光', '仙后信使', '半人马快递',
  '泰坦运输者', '北极星号', '银河商队', '量子跃迁者', '凤凰货轮', '蓝鲸趸船'];
const DESTINATIONS = ['火星殖民地', '木卫二前哨', '泰坦矿场', '比邻星b', '开普勒452b',
  '织女空间站', '土星光环站', '月球背面基地'];

// localStorage 键
const LS_BEST = 'sts_best_v1';
const LS_MUTE = 'sts_muted_v1';

// 全局字体（中文）
const FONT_FAMILY = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif';
