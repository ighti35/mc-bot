// mc-bot/modules/builder.js — 建造模块（创造模式 + 服务器 /setblock /fill 指令）
// 核心思路：建房时切到创造模式，用 /setblock 和 /fill 在服务器层整栋建造。
// 不再逐格走位 placeBlock（那需要库存、寻路、且 placeBlock 回调可能永不触发导致卡死）。

const pathfinder = require('mineflayer-pathfinder');
const { GoalNear } = pathfinder.goals;

// ===== 蓝图：每条是一个 /fill 矩形（相对原点 origin，y 从 0 起）=====
// fields: {x1,y1,z1,x2,y2,z2, block}
// 也用 block:'air' 来抠门/窗（/fill ... air 会把区域内清成空气）

const DESIGNS = {
  // 实心立方体壳
  box: (s) => {
    const w = s, d = s, h = s;
    const L = [];
    L.push(fill(0, 0, 0, w - 1, 0, d - 1, 'floor'));
    L.push(fill(0, h - 1, 0, w - 1, h - 1, d - 1, 'ceil'));
    for (let x = 0; x < w; x++) {
      L.push(fill(x, 1, 0, x, h - 2, 0, 'wall'));
      L.push(fill(x, 1, d - 1, x, h - 2, d - 1, 'wall'));
    }
    for (let z = 0; z < d; z++) {
      L.push(fill(0, 1, z, 0, h - 2, z, 'wall'));
      L.push(fill(w - 1, 1, z, w - 1, h - 2, z, 'wall'));
    }
    return L;
  },

  // 四角柱 + 环箍的塔
  tower: (h) => {
    const L = [];
    const corners = [[0, 0], [0, 2], [2, 0], [2, 2]];
    for (const [x, z] of corners) L.push(fill(x, 0, z, x, h - 1, z, 'wall'));
    for (let y = 0; y < h; y += 4) {
      L.push(fill(0, y, 0, 2, y, 2, 'wall'));
    }
    L.push(fill(0, 0, 0, 2, 0, 2, 'floor'));
    return L;
  },

  // 一堵墙
  wall: (len) => {
    const L = [];
    for (let y = 0; y < Math.max(3, Math.floor(len * 0.7)); y++)
      L.push(fill(0, y, 0, len - 1, y, 0, 'wall'));
    return L;
  },

  // 一块地板
  platform: (s) => {
    return [fill(0, 0, 0, s - 1, 0, s - 1, 'floor')];
  },

  // 小屋：地板 + 四面墙 + 门洞 + 平顶
  house: (s) => {
    const w = s, d = Math.max(3, s), h = Math.max(3, Math.floor(s * 0.8));
    const L = [];
    L.push(fill(0, 0, 0, w - 1, 0, d - 1, 'floor'));
    L.push(fill(0, h, 0, w - 1, h, d - 1, 'ceil'));
    // 前后墙
    L.push(fill(0, 1, 0, w - 1, h - 1, 0, 'wall'));
    L.push(fill(0, 1, d - 1, w - 1, h - 1, d - 1, 'wall'));
    // 左右墙
    L.push(fill(0, 1, 0, 0, h - 1, d - 1, 'wall'));
    L.push(fill(w - 1, 1, 0, w - 1, h - 1, d - 1, 'wall'));
    // 门洞（前面中央，2 格高，左右门框留 1 格）
    const doorX = Math.floor(w / 2);
    L.push(fill(doorX, 1, 0, doorX, 2, 0, 'air'));
    return L;
  },

  // 现代平顶房：更高、大窗、伸出的屋檐
  modern: (s) => {
    const w = Math.max(5, s), d = Math.max(5, s), h = Math.max(4, Math.floor(s * 0.9));
    const L = [];
    L.push(fill(0, 0, 0, w - 1, 0, d - 1, 'floor'));
    L.push(fill(-1, 0, -1, w, 0, d, 'floor')); // 外沿台阶
    L.push(fill(0, h, 0, w - 1, h, d - 1, 'ceil'));
    L.push(fill(-1, h + 1, -1, w, h + 1, d, 'ceil')); // 悬挑屋顶
    L.push(fill(0, 1, 0, w - 1, h - 1, 0, 'wall'));
    L.push(fill(0, 1, d - 1, w - 1, h - 1, d - 1, 'wall'));
    L.push(fill(0, 1, 0, 0, h - 1, d - 1, 'wall'));
    L.push(fill(w - 1, 1, 0, w - 1, h - 1, d - 1, 'wall'));
    // 大面积玻璃窗（前墙中段）
    const glassL = Math.max(1, Math.floor(w / 3));
    const wx = Math.floor(w / 2) - Math.floor(glassL / 2);
    for (let x = wx; x < wx + glassL; x++) L.push(fill(x, 2, 0, x, h - 2, 0, 'window'));
    // 门
    const doorX = Math.floor(w / 2);
    L.push(fill(doorX, 1, 0, doorX, 2, 0, 'air'));
    return L;
  },

  // 木屋：尖顶（阶梯上收）+ 门廊
  cottage: (s) => {
    const w = Math.max(5, s), d = Math.max(5, s), wallH = Math.max(3, Math.floor(s * 0.6));
    const L = [];
    L.push(fill(0, 0, 0, w - 1, 0, d - 1, 'floor'));
    // 墙体
    L.push(fill(0, 1, 0, w - 1, wallH, 0, 'wall'));
    L.push(fill(0, 1, d - 1, w - 1, wallH, d - 1, 'wall'));
    L.push(fill(0, 1, 0, 0, wallH, d - 1, 'wall'));
    L.push(fill(w - 1, 1, 0, w - 1, wallH, d - 1, 'wall'));
    // 山形墙（前后墙每层向内收一格）
    for (let y = 1; y <= Math.floor(d / 2); y++) {
      L.push(fill(y, wallH + y, 0, w - 1 - y, wallH + y, 0, 'wall'));
      L.push(fill(y, wallH + y, d - 1, w - 1 - y, wallH + y, d - 1, 'wall'));
    }
    // 屋顶（左右两面斜坡，用阶梯近似）
    const peakY = wallH + Math.floor(d / 2);
    for (let y = wallH + 1; y <= peakY; y++) {
      const inset = peakY - y;
      L.push(fill(0, y, inset, w - 1, y, inset, 'roof'));
      L.push(fill(0, y, d - 1 - inset, w - 1, y, d - 1 - inset, 'roof'));
    }
    L.push(fill(1, peakY, Math.floor(d / 2), w - 2, peakY, Math.floor(d / 2), 'roof'));
    // 门
    const doorX = Math.floor(w / 2);
    L.push(fill(doorX, 1, 0, doorX, 2, 0, 'air'));
    // 门廊台阶
    L.push(fill(Math.floor(w / 2) - 1, 0, 0, Math.floor(w / 2) + 1, 0, -1, 'floor'));
    return L;
  },

  // 石堡：高墙 + 城齿 + 四角塔
  castle: (s) => {
    const w = Math.max(7, s), d = Math.max(7, s), h = Math.max(5, Math.floor(s * 0.8));
    const L = [];
    L.push(fill(0, 0, 0, w - 1, 0, d - 1, 'floor'));
    // 围墙 1 格厚
    L.push(fill(0, 1, 0, w - 1, h - 1, 0, 'wall'));
    L.push(fill(0, 1, d - 1, w - 1, h - 1, d - 1, 'wall'));
    L.push(fill(0, 1, 0, 0, h - 1, d - 1, 'wall'));
    L.push(fill(w - 1, 1, 0, w - 1, h - 1, d - 1, 'wall'));
    // 城齿（墙顶交替留空）
    for (let x = 0; x < w; x += 2) {
      L.push(fill(x, h, 0, x, h, 0, 'wall'));
      L.push(fill(x, h, d - 1, x, h, d - 1, 'wall'));
    }
    for (let z = 0; z < d; z += 2) {
      L.push(fill(0, h, z, 0, h, z, 'wall'));
      L.push(fill(w - 1, h, z, w - 1, h, z, 'wall'));
    }
    // 四角塔（高出墙 2 格）
    const towerTop = h + 2;
    const corners = [[0, 0], [0, d - 1], [w - 1, 0], [w - 1, d - 1]];
    for (const [cx, cz] of corners) {
      L.push(fill(cx, 1, cz, cx, towerTop, cz, 'wall'));
      L.push(fill(cx - 1, towerTop, cz - 1, cx + 1, towerTop, cz + 1, 'wall'));
    }
    // 城门（前墙中央）
    const doorX = Math.floor(w / 2);
    L.push(fill(doorX, 1, 0, doorX, 2, 0, 'air'));
    return L;
  },

  // 金字塔：每层向内收圆的阶梯
  ziggurat: (s) => {
    const base = Math.max(5, s);
    const L = [];
    const half = Math.floor(base / 2);
    for (let layer = 0; layer < half; layer++) {
      const inset = half - layer;
      L.push(fill(inset, layer, inset, base - 1 - inset, layer, base - 1 - inset, 'wall'));
    }
    return L;
  },
};

// /fill 矩形辅助
function fill(x1, y1, z1, x2, y2, z2, kind) {
  return { x1, y1, z1, x2, y2, z2, kind };
}

// 材质选择：按 kind 映射到 Minecraft 方块名
const MAT = {
  floor: 'stone_bricks', ceil: 'stone_bricks', wall: 'stone_bricks',
  roof: 'oak_planks', window: 'glass',
};
// 根据设计/材质覆盖（design 默认材质）
const DESIGN_MAT = {
  house: 'oak_planks', modern: 'white_concrete', cottage: 'spruce_planks',
  castle: 'stone_bricks', ziggurat: 'sandstone', box: 'stone_bricks',
  tower: 'stone_bricks', wall: 'stone_bricks', platform: 'stone',
};
function blockFor(kind, design, material) {
  if (kind === 'air') return 'air';
  if (kind === 'window') return 'glass';
  if (material) {
    // 用户指定材质：floor/ceil/wall/roof 都用它
    return material;
  }
  return MAT[kind] || DESIGN_MAT[design] || 'stone_bricks';
}

// ===== 从预置图纸 JSON 建造（真正复刻开源建筑）=====
const fs = require('fs');
const path = require('path');
const SCHEMATIC_DIR = path.join(__dirname, '..', 'data', 'schematics');
const schematicsCache = {};

function loadSchematic(name) {
  if (schematicsCache[name]) return schematicsCache[name];
  const safe = name.replace(/[^a-z0-9_-]/gi, '');
  const file = path.join(SCHEMATIC_DIR, safe + '.json');
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  schematicsCache[name] = data;
  return data;
}

function listSchematics() {
  if (!fs.existsSync(SCHEMATIC_DIR)) return [];
  return fs.readdirSync(SCHEMATIC_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

// 逐格 /setblock 复刻一份图纸
// /setblock 是命令（不是普通聊天），不受 MC 聊天反垃圾速率限制，可快速连发。
// 只在每 600 条让出一次事件循环即可防打满服务器命令队列。
async function buildSchematic(schem, origin, bot, state) {
  const { blocks, size } = schem;
  const total = blocks.length;
  let done = 0;
  let lastReport = 0;
  for (const b of blocks) {
    if (state.mode !== 'building') break;
    const x = origin.x + b.x;
    const y = origin.y + b.y;
    const z = origin.z + b.z;
    // 用带属性的 setblock（保留楼梯朝向/原木轴/门半扇），否则退回裸方块 id
    const blockStr = b.setblock || b.name;
    bot.chat(`/setblock ${x} ${y} ${z} ${blockStr}`);
    done++;
    // 每 600 条略歇，给服务器事件循环喘息
    if (done % 600 === 0) await sleep(20);
    // 每 25% 报一次进度
    if (done - lastReport >= total / 4) {
      lastReport = done;
      bot.chat(`进度 ${done}/${total} (${Math.floor((done / total) * 100)}%)`);
    }
  }
  return done;
}

// ===== 主入口 =====
// args: [design, sizeStr, materialOrNull]（来自 !build 或 AI 转成数组）
// design 可以是几何房型(house/modern/castle...) 或一份预置图纸名(large-survival-house)
async function startBuilder(args, bot, state) {
  const [design, sizeStr, material] = args;
  const size = parseInt(sizeStr) || 5;

  // 优先：若 design 是已转换好的图纸 JSON，走忠实复刻
  const schematic = loadSchematic(design);
  if (schematic) {
    await buildFromSchematic(schematic, design, bot, state);
    return;
  }

  const designFn = DESIGNS[design];
  if (!designFn) {
    const avail = Object.keys(DESIGNS).concat(listSchematics()).join(', ');
    bot.chat(`未知房型: ${design}. 可用: ${avail}`);
    resetToIdle(state);
    return;
  }

  const createdPos = bot.entity.position.floored();
  const rects = designFn(size);

  try {
    // 1) 切创造模式
    if (!await setGamemode(bot, 'creative')) {
      // 无权限：聊天提示，回退到生存 + /give + /setblock（指令通常可用）
      bot.chat('我没权限切创造（服务器可能没开作弊）。请执行 /op Claude_Bot，或用 /give 给我方块。');
      // 尝试 /give 一批方块后仍用 /setblock 建（/setblock 一般不需要创造）
      await giveBuildingBlock(bot, design, size, material);
    }

    bot.chat(`开始建造 ${design} (${rects.length} 个区域)...`);
    state.mode = 'building';
    state.currentTask = `Building: ${design} ${size}`;

    // 2) 计算原点：让结构中心落在当前 blob 正下方（玩家脚下）
    let maxW = 0, maxD = 0;
    for (const r of rects) {
      maxW = Math.max(maxW, r.x2 - r.x1 + 1, r.x1, 0);
      maxD = Math.max(maxD, r.z2 - r.z1 + 1, r.z1, 0);
    }
    const origin = {
      x: createdPos.x - Math.floor(maxW / 2),
      y: createdPos.y - 1,
      z: createdPos.z - Math.floor(maxD / 2),
    };

    // 3) 逐区域发送 /fill（或 /setblock）
    let executed = 0;
    for (const r of rects) {
      if (state.mode !== 'building') break;
      const b = blockFor(r.kind, design, material);
      const x1 = origin.x + r.x1, y1 = origin.y + r.y1, z1 = origin.z + r.z1;
      const x2 = origin.x + r.x2, y2 = origin.y + r.y2, z2 = origin.z + r.z2;
      const cmd = (x1 === x2 && y1 === y2 && z1 === z2)
        ? `/setblock ${x1} ${y1} ${z1} ${b}`
        : `/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${b}`;
      bot.chat(cmd);
      executed++;
      await sleep(60);
    }

    bot.chat(`建造完成！共 ${executed} 个区域`);
  } catch (e) {
    console.error('[Builder] 建造出错:', e.message);
    bot.chat(`建造中断: ${e.message}`);
  } finally {
    // 4) 无论成败都要切回生存并释放模式
    await setGamemode(bot, 'survival').catch(() => {});
    resetToIdle(state);
  }
}

// 分块把某区域清成空气。/fill 单次体积上限 32768，超了必须拆成多块。
const MAX_FILL = 30000; // 留点余量，避免 32768 边缘踩线
async function clearArea(bot, origin, size) {
  const x1 = origin.x, y1 = origin.y, z1 = origin.z;
  const x2 = origin.x + size.x - 1, y2 = origin.y + size.y - 1, z2 = origin.z + size.z - 1;
  const w = x2 - x1 + 1, d = z2 - z1 + 1, h = y2 - y1 + 1;
  // 每层最多能放的块数，按 y 切片填；一层也超就再横向切
  let layerD = d;
  while (w * layerD > MAX_FILL) layerD = Math.floor(MAX_FILL / w);
  for (let y = y1; y <= y2; y++) {
    for (let z0 = z1; z0 <= z2; z0 += layerD) {
      const ze = Math.min(z2, z0 + layerD - 1);
      bot.chat(`/fill ${x1} ${y} ${z0} ${x2} ${y} ${ze} air`);
      // 发多了让服务器喘口气
      await sleep(5);
    }
  }
  await sleep(200);
}

// 从图纸 JSON 复刻（忠实逐格）
async function buildFromSchematic(schem, design, bot, state) {
  const { size, totalBlocks, name } = schem;
  const createdPos = bot.entity.position.floored();
  // 原点：让结构中心落在玩家脚下，y 最低层贴玩家脚下的地面（往下1格做地基）
  const origin = {
    x: createdPos.x - Math.floor(size.x / 2),
    y: createdPos.y - 1,
    z: createdPos.z - Math.floor(size.z / 2),
  };

  try {
    if (!await setGamemode(bot, 'creative')) {
      bot.chat('我没权限切创造。请执行 /op Claude_Bot（/setblock 一般仍可用）。');
    }
    bot.chat(`开始复刻开源建筑: ${name} (${totalBlocks} 个方块)...`);
    state.mode = 'building';
    state.currentTask = `Building: ${name}`;

    // 先清空整个规格空间为空气（清除可能的地形/障碍），再逐格放置。
    // /fill 单次上限 32768 体积，超出必须分块。
    await clearArea(bot, origin, size);

    const done = await buildSchematic(schem, origin, bot, state);
    bot.chat(`复刻完成！放置 ${done}/${totalBlocks} 个方块`);
  } catch (e) {
    console.error('[Builder] 图纸复刻出错:', e.message);
    bot.chat(`复刻中断: ${e.message}`);
  } finally {
    await setGamemode(bot, 'survival').catch(() => {});
    resetToIdle(state);
  }
}

function resetToIdle(state) {
  if (state.mode === 'building') state.mode = 'idle';
  state.currentTask = null;
}

// 切换创造/生存模式，轮询直到生效；返回是否成功
function setGamemode(bot, mode) {
  return new Promise((resolve) => {
    const targetMode = mode === 'creative' ? 1 : 0; // 1=creative, 0=survival
    // 已在该模式则直接成功
    if (bot.game && bot.game.gameMode === targetMode && !bot._awaitingGamemode) {
      return resolve(true);
    }
    bot.chat(`/gamemode ${mode}`);
    const start = Date.now();
    const iv = setInterval(() => {
      if (bot.game && bot.game.gameMode === targetMode) {
        clearInterval(iv);
        clearTimeout(to);
        bot._awaitingGamemode = false;
        resolve(true);
      } else if (Date.now() - start > 8000) {
        clearInterval(iv);
        clearTimeout(to);
        bot._awaitingGamemode = false;
        resolve(false); // 权限不足或超时
      }
    }, 300);
    const to = setTimeout(() => {
      clearInterval(iv);
      bot._awaitingGamemode = false;
      resolve(false);
    }, 9000);
  });
}

// 给 bot 一批建造方块（生存兜底用 /give）
async function giveBuildingBlock(bot, design, size, material) {
  const block = material || DESIGN_MAT[design] || 'stone_bricks';
  const count = Math.min(64, Math.max(64, size * size * 2));
  bot.chat(`/give @s ${block} ${count}`);
  await sleep(300);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { startBuilder };
