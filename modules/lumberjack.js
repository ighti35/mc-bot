// mc-bot/modules/lumberjack.js — 砍树模块 v3（预扫描 + 分层挖掘 + 动态重扫）
const { GoalNear } = require('mineflayer-pathfinder').goals;
const Vec3 = require('vec3').Vec3;

/**
 * 砍最近的树，返回实际捡到的物品数量
 */
function chopNearestTree(bot, state) {
  return new Promise(async (resolve) => {
    // 1. 找最近的树
    const treeBlock = bot.findBlock({
      matching: b => b.name && (b.name.endsWith('_log') || b.name.endsWith('_wood')),
      maxDistance: 32,
    });
    if (!treeBlock) { bot.chat('附近没有树！'); resolve(0); return; }

    // 2. 地形预扫描：BFS 找整棵树所有原木
    const allLogs = bfsTreeLogs(bot, treeBlock);
    if (allLogs.length === 0) { bot.chat('找不到原木！'); resolve(0); return; }

    const blockName = allLogs[0].name;
    const woodType = blockName.replace('_log', '').replace('_wood', '');
    const invBefore = countWoodInInventory(bot, blockName);

    // 3. 过滤可达方块 + 按 Y 分层
    const reachable = filterReachable(bot, allLogs);
    console.log(`[Lumberjack] 扫描完成: ${allLogs.length}块总原木, ${reachable.length}块可达, 砍前背包${invBefore}个`);
    bot.chat(`扫描: ${woodType}树 ${allLogs.length}块原木`);

    if (reachable.length === 0) {
      bot.chat('树太高了够不到！');
      resolve(0);
      return;
    }

    // 4. 按 Y 分层（从低到高），逐层挖掘
    const layers = groupByY(reachable);
    let mined = 0;
    let stuckStreak = 0;
    const CHOP_TIMEOUT = 120000;
    const chopStart = Date.now();

    for (const layer of layers) {
      if (Date.now() - chopStart > CHOP_TIMEOUT) break;
      if (state.mode !== 'chopping') break;
      if (bot.health < 8) { bot.chat('有危险！'); break; }

      // 走到这一层最近的方块
      const nearest = findNearest(bot, layer);
      if (nearest) {
        const d = bot.entity.position.distanceTo(new Vec3(nearest.x, nearest.y, nearest.z));
        if (d > 4) {
          try { await walkTo(bot, nearest.x, nearest.y, nearest.z, 8000); } catch (_) {}
        }
      }

      // 挖这一层的所有方块
      for (const log of layer) {
        if (Date.now() - chopStart > CHOP_TIMEOUT) break;
        if (state.mode !== 'chopping') break;

        // 重新检查方块是否还存在
        const cur = bot.blockAt(new Vec3(log.x, log.y, log.z));
        if (!cur || !cur.name || (!cur.name.endsWith('_log') && !cur.name.endsWith('_wood'))) continue;

        const success = await mineOneBlock(bot, log, state);
        if (success) {
          mined++;
          stuckStreak = 0;
        } else {
          stuckStreak++;
          if (stuckStreak >= 3) {
            // 连续 3 个挖不到，可能需要重新定位
            console.log('[Lumberjack] 连续失败，重新定位...');
            try { await walkTo(bot, log.x, log.y, log.z, 5000); } catch (_) {}
            stuckStreak = 0;
          }
        }
      }

      // 每层挖完，捡一下掉落物 + 重扫新暴露的方块
      await quickCollect(bot);
    }

    // 5. 最后全面收尾
    console.log('[Lumberjack] 最后收集...');
    for (let pass = 0; pass < 3; pass++) {
      await quickCollect(bot);
      await sleep(1000);
    }

    // 6. 统计
    const invAfter = countWoodInInventory(bot, blockName);
    const collected = invAfter - invBefore;
    console.log(`[Lumberjack] 完成: 挖${mined}块, 收${collected}个 (${invBefore}→${invAfter})`);

    if (collected > 0) {
      bot.chat(`砍完了！收到${collected}个${woodType}原木`);
    } else {
      bot.chat(`挖了${mined}块但没捡到掉落物...`);
    }

    resolve(collected > 0 ? collected : mined);
  });
}

// ========== 地形扫描 ==========

function bfsTreeLogs(bot, startBlock) {
  const blocks = [];
  const visited = new Set();
  const queue = [startBlock.position];
  const startPos = startBlock.position;

  while (queue.length > 0) {
    const pos = queue.shift();
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (pos.distanceTo(startPos) > 8) continue;

    const block = bot.blockAt(pos);
    if (!block || !block.name) continue;
    if (!block.name.endsWith('_log') && !block.name.endsWith('_wood')) continue;

    blocks.push({ x: pos.x, y: pos.y, z: pos.z, name: block.name });

    for (const [dx, dy, dz] of [[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
      queue.push(pos.offset(dx, dy, dz));
    }
  }

  return blocks;
}

// 过滤：只保留 bot 能够到的方块
function filterReachable(bot, logs) {
  const botY = bot.entity.position.y;
  return logs.filter(log => {
    const vertDist = Math.abs(log.y - botY);
    return vertDist <= 4.5;
  });
}

// 按 Y 坐标分层分组
function groupByY(logs) {
  const map = new Map();
  for (const log of logs) {
    if (!map.has(log.y)) map.set(log.y, []);
    map.get(log.y).push(log);
  }
  // 按 Y 从低到高排序
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
}

// 找离 bot 最近的方块
function findNearest(bot, logs) {
  let best = null, bestDist = Infinity;
  for (const log of logs) {
    const d = bot.entity.position.distanceTo(new Vec3(log.x, log.y, log.z));
    if (d < bestDist) { bestDist = d; best = log; }
  }
  return best;
}

// ========== 移动 ==========

function walkTo(bot, x, y, z, timeout = 10000) {
  return new Promise((resolve, reject) => {
    bot.pathfinder.setGoal(new GoalNear(x, y, z, 2));
    const start = Date.now();
    const check = setInterval(() => {
      const dist = bot.entity.position.distanceTo(new Vec3(x, y, z));
      if (dist < 3) { clearInterval(check); resolve(); return; }
      if (Date.now() - start > timeout) { clearInterval(check); reject(new Error('timeout')); }
    }, 200);
  });
}

// ========== 挖掘（轮询） ==========

function mineOneBlock(bot, pos, state) {
  return new Promise((resolve) => {
    const block = bot.blockAt(new Vec3(pos.x, pos.y, pos.z));
    if (!block || !block.name) { resolve(false); return; }
    if (!block.name.endsWith('_log') && !block.name.endsWith('_wood')) { resolve(false); return; }

    const dist = bot.entity.position.distanceTo(block.position);
    const vertDist = Math.abs(block.position.y - bot.entity.position.y);

    if (vertDist > 4.5) { resolve(false); return; }
    if (dist > 6) { resolve(false); return; }

    // 太远 → 先靠近
    if (dist > 4) {
      walkTo(bot, pos.x, pos.y, pos.z, 5000)
        .then(() => mineOneBlock(bot, pos, state).then(resolve))
        .catch(() => resolve(false));
      return;
    }

    if (!bot.canDigBlock(block)) {
      bot.setControlState('jump', true);
      setTimeout(() => {
        bot.setControlState('jump', false);
        if (!bot.canDigBlock(block)) { resolve(false); return; }
        startDig();
      }, 400);
      return;
    }

    startDig();

    function startDig() {
      try { bot.stopDigging(); } catch (_) {}
      try { bot.lookAt(block.position.offset(0.5, 0.5, 0.5)); } catch (_) {}

      console.log(`[Lumberjack] dig ${block.name} (${pos.x},${pos.y},${pos.z})`);

      bot.dig(block).catch(e => {
        // bot.dig() 是 async 函数，rejection 必须用 .catch 捕获
        if (e.message !== 'Digging aborted') {
          console.log(`[Lumberjack] dig rejected: ${e.message}`);
        }
      });

      const t0 = Date.now();
      const poll = setInterval(() => {
        const cur = bot.blockAt(new Vec3(pos.x, pos.y, pos.z));
        if (!cur || !cur.name || (!cur.name.endsWith('_log') && !cur.name.endsWith('_wood'))) {
          clearInterval(poll);
          resolve(true);
          return;
        }
        if (Date.now() - t0 > 10000) {
          clearInterval(poll);
          try { bot.stopDigging(); } catch (_) {}
          resolve(false);
        }
      }, 200);
    }
  });
}

// ========== 收集 ==========

// 快速走向最近的掉落物
function quickCollect(bot) {
  return new Promise((resolve) => {
    const items = Object.values(bot.entities).filter(
      e => (e.name === 'item' || e.name === 'Item') && e.position.distanceTo(bot.entity.position) < 10
    );
    if (items.length === 0) { resolve(); return; }

    let best = null, bestDist = Infinity;
    for (const it of items) {
      const d = it.position.distanceTo(bot.entity.position);
      if (d < bestDist) { bestDist = d; best = it; }
    }

    if (!best || bestDist < 1.5) { resolve(); return; }

    bot.pathfinder.setGoal(new GoalNear(best.position.x, best.position.y, best.position.z, 1));
    setTimeout(resolve, 1500);
  });
}

function countWoodInInventory(bot, blockName) {
  let count = 0;
  for (const item of bot.inventory.items()) {
    if (item.name === blockName) count += item.count;
    if (item.name === 'stripped_' + blockName) count += item.count;
  }
  return count;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { chopNearestTree };
