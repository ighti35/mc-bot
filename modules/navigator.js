// mc-bot/modules/navigator.js — 高级导航系统
const pathfinder = require('mineflayer-pathfinder');
const { GoalBlock, GoalNear, GoalXZ } = pathfinder.goals;

// 自动巡路 + 回避危险
function navigateTo(x, y, z, bot, options = {}) {
  return new Promise((resolve, reject) => {
    const { avoidWater = true, avoidLava = true, timeout = 30000 } = options;

    bot.pathfinder.setGoal(new GoalNear(x, y, z, 1));

    const checkTimer = setInterval(() => {
      const dist = bot.entity.position.distanceTo({ x, y, z });
      if (dist < 2) {
        clearInterval(checkTimer);
        clearTimeout(timeoutTimer);
        resolve(true);
      }
    }, 200);

    const timeoutTimer = setTimeout(() => {
      clearInterval(checkTimer);
      bot.pathfinder.setGoal(null);
      reject(new Error(`导航超时 (${timeout}ms)`));
    }, timeout);
  });
}

// 巡逻模式 — 随机走动
function startPatrol(bot, radius = 50) {
  let patrolActive = true;
  const origin = bot.entity.position.clone();

  function patrol() {
    if (!patrolActive) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * radius;
    const tx = origin.x + Math.cos(angle) * dist;
    const tz = origin.z + Math.sin(angle) * dist;
    const goal = new GoalXZ(tx, tz);
    bot.pathfinder.setGoal(goal);
    setTimeout(patrol, 8000 + Math.random() * 5000);
  }

  patrol();

  return {
    stop: () => { patrolActive = false; bot.pathfinder.setGoal(null); },
  };
}

// 自动走楼梯/搭桥
function autoBridge(bot, targetDepth) {
  const pos = bot.entity.position;
  if (pos.y < targetDepth - 1) return; // 已在地下

  bot.chat('§6自动搭桥下降...');
  const below = bot.blockAt(pos.offset(0, -1, 0));
  if (!below || below.name === 'air' || below.name === 'water') {
    // 放置方块在脚下
    const blockToPlace = bot.inventory.items().find(i => i.name.includes('dirt') || i.name.includes('cobblestone'));
    if (blockToPlace) {
      bot.equip(blockToPlace, 'hand').then(() => {
        const refBlock = bot.blockAt(pos.offset(0, -2, 0));
        if (!refBlock) return;
        // 必须带回调，否则 placeBlock 的 promise 在 blockUpdate 超时时 reject
        // 变成 UnhandledRejection 会直接崩掉整个进程
        bot.placeBlock(refBlock, new Vec3(0, 1, 0), (err) => {
          if (err) console.log('[autoBridge] 放置失败:', err.message);
        });
      }).catch((e) => console.log('[autoBridge] equip 失败:', e.message));
    }
  }
}

// 跟随轨迹回到起点
function backtrack(bot, path, index = 0) {
  if (index >= path.length) { bot.chat('§a已回溯完毕'); return; }
  const point = path[index];
  bot.pathfinder.setGoal(new GoalBlock(point.x, point.y, point.z));
  const check = setInterval(() => {
    if (bot.entity.position.distanceTo(point) < 2) {
      clearInterval(check);
      backtrack(bot, path, index + 1);
    }
  }, 500);
}

module.exports = { navigateTo, startPatrol, autoBridge, backtrack };
