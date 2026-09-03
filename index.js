// mc-bot/index.js — Claude AI Minecraft 助手机器人
const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock');
const autoEat = require('mineflayer-auto-eat');
const armorManager = require('mineflayer-armor-manager');
const toolPlugin = require('mineflayer-tool');
const fs = require('fs');
const path = require('path');

// === 输出分流：stdout/stderr 同时写入日志文件，便于实时查看思考过程 ===
const LOG_FILE = path.join(__dirname, 'data', 'bot.log');
try {
  const logDir = path.dirname(LOG_FILE);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  const tee = (chunk) => { logStream.write(chunk); };
  const origLog = console.log;
  console.log = (...args) => { const s = args.join(' ') + '\n'; origLog(...args); tee(s); };
  const origErr = console.error;
  console.error = (...args) => { const s = args.join(' ') + '\n'; origErr(...args); tee(s); };
  // 也捕获 process.stdout/stderr 的原生写入（thinklog 用 console.log 已覆盖）
} catch (_) {}

// === 防重复启动：检查是否有另一个 bot 在运行 ===
const LOCK_FILE = path.join(__dirname, 'data', '.bot.lock');
try {
  const lockDir = path.dirname(LOCK_FILE);
  if (!fs.existsSync(lockDir)) fs.mkdirSync(lockDir, { recursive: true });
  if (fs.existsSync(LOCK_FILE)) {
    const pid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    // 检查该 PID 是否还在运行
    try { process.kill(parseInt(pid), 0); console.error(`❌ 另一个 bot 正在运行 (PID: ${pid})！先关掉它再启动。`); process.exit(1); } catch {}
    // PID 不存在，清理旧的锁文件
    fs.unlinkSync(LOCK_FILE);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
} catch (e) { console.warn('⚠️  无法创建锁文件:', e.message); }

// 退出时清理锁文件
function cleanupLock() {
  try { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE); } catch (_) {}
}
process.on('exit', cleanupLock);
process.on('SIGINT', () => { cleanupLock(); process.exit(); });
process.on('SIGTERM', () => { cleanupLock(); process.exit(); });
// 正常的中断类错误：不视为致命，不退出进程
// - Digging aborted: 挖掘被主动打断
// - blockUpdate ... timeout: 放置方块等待事件超时（常见于放不进/距离过远），mineflayer 正常行为
function isBenignError(err) {
  if (!err || !err.message) return false;
  const msg = err.message;
  return msg === 'Digging aborted' ||
         /did not fire within timeout/i.test(msg) ||
         /blockUpdate.*did not fire/i.test(msg);
}

process.on('uncaughtException', (err) => {
  if (isBenignError(err)) { console.log('[忽略正常中断]', err.message); return; }
  console.error('[Fatal]', err);
  cleanupLock();
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  if (isBenignError(reason)) { console.log('[忽略正常中断]', reason.message); return; }
  console.error('[UnhandledRejection]', reason);
  cleanupLock();
  process.exit(1);
});

// === 配置检查 ===
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('❌ 找不到 config.json！');
  console.error('   请复制 config.example.json 为 config.json 并填入你的信息：');
  console.error('   copy config.example.json config.json');
  process.exit(1);
}
const config = require('./config.json');

// 验证必要的配置项
if (!config.aiApiKey || config.aiApiKey.includes('你的DeepSeek')) {
  console.error('❌ 请在 config.json 中填入你的 DeepSeek API Key');
  console.error('   在 https://platform.deepseek.com 注册获取');
  process.exit(1);
}
if (!config.owner || config.owner === '你的游戏ID') {
  console.warn('⚠️  建议在 config.json 中设置你的游戏 ID (owner)');
}

const { handleChat } = require('./modules/chat');
const { startWandering } = require('./modules/wander');
const { initCombat, stopCombat } = require('./modules/combat');
const { initAI } = require('./modules/ai');
const { initDeathAnalyzer } = require('./modules/death-analyzer');
const { initAntiStuck, stopAntiStuck, escapeWater } = require('./modules/anti-stuck');
const itemNames = require('./data/items.json');

let bot;
let reconnectCount = 0;
let firstSpawnDone = false; // 只有首次成功 spawn 才重置重连计数
let lastKickReason = null;
const MAX_RECONNECT = 10;

let waterCheckInterval = null;

function createBot() {
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username + (reconnectCount > 0 ? `_${reconnectCount}` : ''),
    version: config.version,
  });

  bot.loadPlugin(pathfinder.pathfinder);
  bot.loadPlugin(collectBlock.plugin);
  // auto-eat is ESM: exports { loader }
  bot.loadPlugin(autoEat.loader);
  // armor-manager: module.exports = initializeBot (function itself)
  bot.loadPlugin(armorManager);
  bot.loadPlugin(toolPlugin.plugin);

  const state = {
    sleeping: false,
    currentTask: null,
    target: null,
    home: null,
    mapCache: new Map(),
    chestCache: new Map(),
    friends: new Set(),
    mode: 'idle',
    stats: { blocksMined: 0, distanceWalked: 0, itemsCollected: 0, actionHistory: [] },
  };

  // === 启动死亡分析器 ===
  initDeathAnalyzer(bot, state, config);
  console.log('[Bot] 死亡分析器已就绪');

  // 全局暴露
  global.bot = bot;
  global.state = state;
  global.config = config;
  global.itemNames = itemNames;

  bot.once('spawn', () => {
    if (!firstSpawnDone) {
      firstSpawnDone = true;
      reconnectCount = 0;
    }
    console.log(`[Bot] 已生成: ${bot.username}`);

    // === 安全化 stopDigging，防止 Digging aborted 崩溃 ===
    // 注意：只 patch stopDigging，不要 patch dig（pathfinder 依赖其返回值）
    const origStopDigging = bot.stopDigging.bind(bot);
    bot.stopDigging = function () {
      try { origStopDigging(); } catch (e) {
        // 忽略 Digging aborted 错误（正常中断），其他日志输出
        if (e.message !== 'Digging aborted') console.error('[SafeStop]', e.message);
      }
    };

    const mcData = require('minecraft-data')(bot.version);
    bot.mcData = mcData;

    const movements = new pathfinder.Movements(bot, mcData);
    // === 寻路配置：允许挖掘和搭高，否则 bot 会被任何障碍物困死 ===
    movements.canDig = true;
    movements.allow1by1tower = true;
    movements.canSwim = true;
    // scafoldingBlocks 留空，pathfinder 自动从背包选方块
    movements.scafoldingBlocks = [];

    // 黑名单：禁止挖掘的方块（防止拆玩家建筑）
    const noBreak = [
      'chest', 'trapped_chest', 'ender_chest', 'barrel', 'shulker_box',
      'furnace', 'blast_furnace', 'smoker', 'crafting_table', 'anvil',
      'enchanting_table', 'brewing_stand', 'beacon', 'jukebox',
      'bed', 'respawn_anchor', 'lodestone', 'ender_chest',
      'oak_door', 'iron_door', 'spruce_door', 'birch_door', 'jungle_door',
      'acacia_door', 'dark_oak_door', 'mangrove_door', 'cherry_door',
      'bamboo_door', 'crimson_door', 'warped_door',
      'oak_trapdoor', 'iron_trapdoor', 'spruce_trapdoor', // ... all trapdoors
    ];
    // 遍历 mcData 找到对应的 block id 加入黑名单
    for (const blockName of noBreak) {
      const block = mcData.blocksByName[blockName];
      if (block) movements.blocksCantBreak.add(block.id);
    }
    // 也禁止挖掘所有带 _trapdoor、_door、_sign 的方块
    for (const [name, block] of Object.entries(mcData.blocksByName)) {
      if (name.includes('trapdoor') || name.includes('_door') || name.includes('_sign') || name.includes('_button') || name.includes('_pressure_plate')) {
        movements.blocksCantBreak.add(block.id);
      }
    }

    bot.pathfinder.setMovements(movements);

    bot.autoEat.setOpts({ minHunger: 14, priority: 'foodPoints' });
    bot.autoEat.enableAuto();

    bot.armorManager.equipAll();

    // === 水域生存：检测溺水自动上浮（增强版：找岸边而非原地扑腾）===
    waterCheckInterval = setInterval(() => {
      if (!bot.entity || !bot.entity.position) return;
      const head = bot.blockAt(bot.entity.position.offset(0, 1.6, 0));
      const feet = bot.blockAt(bot.entity.position);
      const inWater = (head && (head.name === 'water' || head.name === 'bubble_column')) ||
                      (feet && (feet.name === 'water' || feet.name === 'bubble_column'));
      if (inWater) {
        const oxygen = bot.entity.oxygen || 10;
        if (oxygen < 8 || bot.entity.position.y < 50) {
          // 使用 anti-stuck 的智能上岸：找最近岸边游过去
          if (!escapeWater(bot, state)) {
            // fallback: 如果没找到岸，原地跳跃上浮
            bot.setControlState('jump', true);
            if (oxygen < 4) bot.pathfinder.setGoal(null);
          }
        }
      } else {
        bot.setControlState('jump', false);
      }
    }, 1000);

    // 启动自动漫游
    if (config.autoWander) {
      startWandering(bot, state, config);
      console.log('[Bot] 自动漫游已启用');
    }

    // 启动战斗系统（自动反击非owner的生物）
    initCombat(bot, state, config);
    console.log('[Bot] 战斗系统已启用');

    // 启动防卡死自救系统
    initAntiStuck(bot, state, config);

    // 设置最大血量（需要服务器开启 OP 权限）
    // 你在游戏里手动执行: /op Claude_Bot 然后 bot 会自动设血量
    setTimeout(() => {
      bot.chat('/attribute @s minecraft:max_health base set 40');
      bot.chat('/attribute @s minecraft:attack_damage base set 8');
      console.log('[Bot] 属性设置指令已发送');
    }, 1000);

    bot.chat(config.welcomeMessage);
    console.log('[Bot] 就绪！等待指令...');
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    handleChat(username, message, bot, state, config);
  });

  bot.on('error', (err) => console.error('[Bot Error]', err));

  bot.on('end', (reason) => {
    if (waterCheckInterval) { clearInterval(waterCheckInterval); waterCheckInterval = null; }
    console.log(`[Bot] 断开: ${reason}`);
    reconnectCount++;
    if (reconnectCount <= MAX_RECONNECT) {
      // 如果是 duplicate_login（旧连接未释放），等待更长时间
      const isDup = lastKickReason && typeof lastKickReason === 'object' &&
        JSON.stringify(lastKickReason).includes('duplicate_login');
      lastKickReason = null;
      const delay = isDup ? 15000 : 3000;
      console.log(`[Bot] 正在重连 (${reconnectCount}/${MAX_RECONNECT})${isDup ? ' [等待旧连接释放]' : ''}...`);
      setTimeout(() => createBot(), delay);
    } else {
      console.log(`[Bot] 已达最大重连次数 (${MAX_RECONNECT})，停止重连。`);
      process.exit(0);
    }
  });

  bot.on('kicked', (reason) => {
    console.log('[Bot] 被踢:', typeof reason === 'object' ? JSON.stringify(reason) : reason);
    lastKickReason = reason;
  });

  console.log(`[Bot] 正在连接 ${config.host}:${config.port} ...`);
  console.log(`[Bot] 用户名: ${config.username}`);
}

// 初始化 AI 大脑
initAI(config);

createBot();
