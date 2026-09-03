// mc-bot/modules/anti-stuck.js — 防卡死自救系统
const Vec3 = require('vec3').Vec3;

let checkInterval = null;
let lastPos = null;
let stuckSeconds = 0;
let consecutiveStucks = 0;
let currentEscapeLevel = 0; // 0=none, 1=replan, 2=jump, 3=tower, 4=dig, 5=tp
let escapeTimer = null;
let inEscape = false;

/**
 * 初始化防卡死系统
 */
function initAntiStuck(bot, state, config) {
  stopAntiStuck();

  console.log('[AntiStuck] 防卡死系统已就绪');

  checkInterval = setInterval(() => {
    if (!bot.entity || !bot.entity.position) return;
    if (state.mode === 'sleeping') return;
    if (inEscape) return; // 自救过程中不重复检测

    const pos = bot.entity.position;
    const hasGoal = bot.pathfinder && bot.pathfinder.goal !== null;

    // 没有寻路目标 → 不算卡死，重置
    if (!hasGoal && state.mode !== 'combat') {
      stuckSeconds = 0;
      lastPos = pos.clone();
      return;
    }

    // 战斗中交给 combat 自己的逻辑
    if (state.mode === 'combat' || state.mode === 'chopping') {
      return;
    }

    // 检查是否移动了
    if (lastPos) {
      const moved = pos.distanceTo(lastPos);
      if (moved < 1.5) {
        stuckSeconds += 3;

        if (stuckSeconds >= 10 && stuckSeconds < 12) {
          console.log(`[AntiStuck] 警告: 10秒未移动 (mode:${state.mode})`);
        }

        if (stuckSeconds >= 20) {
          console.log(`[AntiStuck] 卡死! 启动自救 (${stuckSeconds}s)`);
          handleStuck(bot, state, config);
        }
      } else {
        // 移动了，重置
        if (stuckSeconds > 0) {
          console.log(`[AntiStuck] 恢复移动 (${moved.toFixed(1)}m)`);
        }
        stuckSeconds = 0;
        currentEscapeLevel = 0;
        consecutiveStucks = 0;
      }
    }

    lastPos = pos.clone();
  }, 3000);
}

/**
 * 外部调用：重置卡死计时器（人工干预后调用）
 */
function resetStuckTimer() {
  stuckSeconds = 0;
  currentEscapeLevel = 0;
  inEscape = false;
  if (escapeTimer) { clearTimeout(escapeTimer); escapeTimer = null; }
}

/**
 * 处理卡死：分层自救
 */
function handleStuck(bot, state, config) {
  inEscape = true;
  currentEscapeLevel++;

  const owner = config.owner || 'player';
  const pos = bot.entity.position;

  switch (currentEscapeLevel) {
    case 1: { // 重规划
      console.log('[AntiStuck] Lv1: 重规划路径');
      bot.pathfinder.setGoal(null);
      bot.chat('卡住了，重新规划路线...');

      // 短暂等待后恢复（让原来调用 goto/explore 的代码重新设 goal）
      escapeTimer = setTimeout(() => {
        inEscape = false;
        stuckSeconds = 0;
        // 如果 AI 的目标还在 state 里，可以重设
        if (state._lastGotoTarget) {
          const { GoalNear } = require('mineflayer-pathfinder').goals;
          const t = state._lastGotoTarget;
          bot.pathfinder.setGoal(new GoalNear(t.x, t.y, t.z, 1));
        }
      }, 2000);
      return;
    }

    case 2: { // 跳跃挣脱
      console.log('[AntiStuck] Lv2: 尝试跳跃');
      bot.setControlState('jump', true);
      // 随机移动方向
      const angle = Math.random() * Math.PI * 2;
      bot.entity.yaw = angle;
      bot.setControlState('forward', true);

      escapeTimer = setTimeout(() => {
        bot.setControlState('jump', false);
        bot.setControlState('forward', false);
        inEscape = false;
        stuckSeconds = 0;

        // 如果还在原地，下一轮会进入更高层自救
        const newPos = bot.entity?.position;
        if (newPos && newPos.distanceTo(pos) < 1) {
          console.log('[AntiStuck] 跳跃无效，准备挖掘逃脱');
        } else {
          currentEscapeLevel = 0; // 成功移动了，重置级别
        }
      }, 3000);
      return;
    }

    case 3: { // 搭高逃脱（1x1 towering）
      console.log('[AntiStuck] Lv3: 搭高逃脱');
      bot.setControlState('jump', true);

      // 找固体方块
      const blockItem = findBuildBlock(bot);
      if (blockItem) {
        towerUp(bot, blockItem, 3, () => {
          bot.setControlState('jump', false);
          inEscape = false;
          stuckSeconds = 0;
          currentEscapeLevel = 0;
        });
      } else {
        bot.chat('没有方块搭高，尝试其他方式...');
        currentEscapeLevel++; // 跳过这级，直接进挖掘
        inEscape = false;
        stuckSeconds = 0;
      }
      return;
    }

    case 4: { // 挖掘逃脱
      console.log('[AntiStuck] Lv4: 挖掘逃脱');
      digOut(bot, pos, () => {
        inEscape = false;
        stuckSeconds = 0;
        const newPos = bot.entity?.position;
        if (newPos && newPos.distanceTo(pos) < 1.5) {
          consecutiveStucks++;
        } else {
          currentEscapeLevel = 0;
          consecutiveStucks = 0;
        }
      });
      return;
    }

    case 5: // 终极：传送
    default: {
      console.log('[AntiStuck] Lv5: 传送救援');
      consecutiveStucks++;
      currentEscapeLevel = 0;

      if (consecutiveStucks >= 3) {
        // 放弃当前任务
        state.mode = 'idle';
        state.currentTask = null;
        consecutiveStucks = 0;
        bot.pathfinder.setGoal(null);
        bot.chat(`主人！我完全卡死了，放弃了当前任务。坐标(${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)})`);
      } else {
        // 尝试传送到主人身边
        bot.chat(`/tp ${owner} ~ ~ ~`);
        bot.chat(`主人！我卡在(${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)})，试了全部方法都不行！`);
      }

      escapeTimer = setTimeout(() => {
        inEscape = false;
        stuckSeconds = 0;
      }, 2000);
      return;
    }
  }
}

/**
 * 在背包里找一个可用来搭高的方块
 */
function findBuildBlock(bot) {
  const items = bot.inventory.items();
  // 优先普通方块
  const preferred = ['dirt', 'cobblestone', 'stone', 'sandstone', 'netherrack', 'deepslate', 'andesite', 'diorite', 'granite'];
  for (const name of preferred) {
    const item = items.find(i => i.name.includes(name) && i.name !== 'stone_sword' && i.name !== 'stone_axe');
    if (item) return item;
  }
  // 后备：任何可放置的方块
  return items.find(i => i.name.includes('planks') || i.name.includes('log') || i.name.includes('wood'));
}

/**
 * 搭高 n 格
 */
function towerUp(bot, blockItem, count, callback) {
  let built = 0;
  const pos = bot.entity.position;

  function placeOne() {
    if (built >= count) {
      callback();
      return;
    }

    bot.equip(blockItem, 'hand').then(() => {
      const below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (below) {
        bot.placeBlock(below, new Vec3(0, 1, 0), (err) => {
          built++;
          setTimeout(placeOne, err ? 400 : 500);
        });
      } else {
        built++;
        setTimeout(placeOne, 400);
      }
    }).catch(() => {
      built++;
      setTimeout(placeOne, 400);
    });
  }

  placeOne();
}

/**
 * 挖掘逃脱：朝前方挖 2 格
 */
function digOut(bot, stuckPos, callback) {
  const dirs = [
    new Vec3(0, 1, 0),   // 上 (优先)
    new Vec3(1, 0, 0),   // 东
    new Vec3(-1, 0, 0),  // 西
    new Vec3(0, 0, 1),   // 南
    new Vec3(0, 0, -1),  // 北
  ];

  let escaped = false;

  function digNext(idx) {
    if (idx >= dirs.length || escaped) {
      callback();
      return;
    }

    const target = stuckPos.offset(dirs[idx].x, dirs[idx].y, dirs[idx].z);
    const block = bot.blockAt(target);
    if (!block) { digNext(idx + 1); return; }

    // 空气、水等不可挖 → 跳过
    if (block.name === 'air' || block.name === 'water' || block.name === 'lava' || block.boundingBox !== 'block') {
      digNext(idx + 1);
      return;
    }

    // 不要挖箱子、熔炉等
    const noDig = ['chest', 'furnace', 'crafting_table', 'anvil', 'enchanting_table', 'bed', 'door', 'trapdoor'];
    if (noDig.some(n => block.name.includes(n))) {
      digNext(idx + 1);
      return;
    }

    console.log(`[AntiStuck] 挖掘: ${block.name} at (${target.x},${target.y},${target.z})`);
    bot.dig(block, true, (err) => {
      if (err) {
        console.log(`[AntiStuck] 挖掘失败: ${err.message}`);
      }
      // 尝试走过去
      bot.setControlState('forward', true);
      setTimeout(() => {
        bot.setControlState('forward', false);
        digNext(idx + 1);
      }, 1000);
    });
  }

  digNext(0);

  // 5 秒后强制结束
  setTimeout(() => {
    escaped = true;
    callback();
  }, 5000);
}

/**
 * 停止防卡死监控
 */
function stopAntiStuck() {
  if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
  if (escapeTimer) { clearTimeout(escapeTimer); escapeTimer = null; }
  inEscape = false;
  stuckSeconds = 0;
  currentEscapeLevel = 0;
  consecutiveStucks = 0;
}

/**
 * 检查 bot 是否在水中，如果在则游上岸
 */
function escapeWater(bot, state) {
  if (!bot.entity || !bot.entity.position) return false;
  const head = bot.blockAt(bot.entity.position.offset(0, 1.6, 0));
  const feet = bot.blockAt(bot.entity.position);
  const inWater = (head && (head.name === 'water' || head.name === 'bubble_column')) ||
                  (feet && (feet.name === 'water' || feet.name === 'bubble_column'));

  if (!inWater) return false;

  console.log('[AntiStuck] 检测到在水中，优先上浮...');

  // 取消当前寻路
  if (bot.pathfinder.goal) {
    bot.pathfinder.setGoal(null);
  }

  // 朝最近的岸边游
  const shore = findNearestShore(bot);
  if (shore) {
    const { GoalNear } = require('mineflayer-pathfinder').goals;
    bot.pathfinder.setGoal(new GoalNear(shore.x, shore.y + 1, shore.z, 1));
    bot.chat('我先游上岸！');
  } else {
    // 没有找到岸边，垂直上浮
    bot.setControlState('jump', true);
    bot.setControlState('forward', true);
    setTimeout(() => {
      bot.setControlState('jump', false);
      bot.setControlState('forward', false);
    }, 5000);
  }

  return true;
}

/**
 * 找最近的岸边（非水方块）
 */
function findNearestShore(bot) {
  const pos = bot.entity.position;
  const searchRadius = 16;

  for (let r = 2; r <= searchRadius; r += 2) {
    for (let dx = -r; dx <= r; dx += r * 2) {
      for (let dz = -r; dz <= r; dz++) {
        const check = new Vec3(Math.floor(pos.x) + dx, Math.floor(pos.y), Math.floor(pos.z) + dz);
        const block = bot.blockAt(check);
        if (block && block.name !== 'water' && block.name !== 'bubble_column' && block.name !== 'air') {
          // 确认这个方块上面是空气（可站立）
          const above = bot.blockAt(check.offset(0, 1, 0));
          if (above && (above.name === 'air')) {
            return check;
          }
        }
      }
    }
    // 也检查水平和垂直方向
    for (let dy = -1; dy <= 1; dy++) {
      for (const offset of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const check = new Vec3(Math.floor(pos.x) + offset[0], Math.floor(pos.y) + dy, Math.floor(pos.z) + offset[1]);
        const block = bot.blockAt(check);
        if (block && block.name !== 'water' && block.name !== 'bubble_column' && block.name !== 'air') {
          const above = bot.blockAt(check.offset(0, 1, 0));
          if (above && above.name === 'air') {
            return check;
          }
        }
      }
    }
  }

  return null;
}

module.exports = { initAntiStuck, stopAntiStuck, resetStuckTimer, escapeWater };
