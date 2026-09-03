// mc-bot/modules/collector.js — 自动收集 & 存储系统
const { collectBlock } = require('mineflayer-collectblock');
const pathfinder = require('mineflayer-pathfinder');
const { GoalBlock } = pathfinder.goals;
const Vec3 = require('vec3');

// 扫描并记录箱子位置
function scanChests(bot, state, radius = 64) {
  const chestBlocks = bot.findBlocks({
    matching: (block) => block.name === 'chest' || block.name === 'trapped_chest' || block.name === 'barrel' || block.name === 'shulker_box',
    maxDistance: radius,
    count: 100,
  });
  chestBlocks.forEach((pos) => {
    const key = `${pos.x},${pos.y},${pos.z}`;
    state.chestCache.set(key, { x: pos.x, y: pos.y, z: pos.z });
  });
  return chestBlocks.length;
}

// 自动存物品到最近的箱子
async function autoDeposit(bot, state, itemsToKeep = []) {
  scanChests(bot, state);
  if (state.chestCache.size === 0) {
    bot.chat('§c附近没有箱子可以存放物品');
    return;
  }

  // 找到最近的箱子
  const botPos = bot.entity.position;
  let nearest = null;
  let nearestDist = Infinity;
  for (const [, chest] of state.chestCache) {
    const dist = botPos.distanceTo(chest);
    if (dist < nearestDist) { nearestDist = dist; nearest = chest; }
  }

  if (!nearest) return;

  // 去箱子位置
  bot.chat('§6前往最近的箱子存放物品...');
  bot.pathfinder.setGoal(new GoalBlock(nearest.x, nearest.y, nearest.z));

  const checkArrived = setInterval(async () => {
    const dist = bot.entity.position.distanceTo(nearest);
    if (dist < 3) {
      clearInterval(checkArrived);
      try {
        // 打开箱子
        const chestBlock = bot.blockAt(new Vec3(nearest.x, nearest.y, nearest.z));
        const chest = await bot.openContainer(chestBlock);
        // 存入所有物品 (保留贵重/工具)
        const toDeposit = bot.inventory.items().filter((item) => {
          return !itemsToKeep.some((keep) => item.name.includes(keep));
        });
        for (const item of toDeposit) {
          try { await chest.deposit(item.type, null, item.count); }
          catch {}
        }
        await chest.close();
        bot.chat(`§a已存入 ${toDeposit.length} 种物品到箱子`);
      } catch (e) {
        bot.chat(`§c存放失败: ${e.message}`);
      }
    }
  }, 300);

  setTimeout(() => clearInterval(checkArrived), 20000);
}

// 大批量收集
async function bulkCollect(bot, blockNames, maxDistance = 32) {
  for (const blockName of blockNames) {
    const block = bot.findBlock({
      matching: (b) => b.name === blockName,
      maxDistance,
    });
    if (block) {
      bot.chat(`§6收集: ${blockName}`);
      await new Promise((resolve) => {
        collectBlock(bot, blockName, { maxDistance }, (err) => {
          if (err) console.log(`收集 ${blockName} 失败:`, err.message);
          resolve();
        });
      });
    }
  }
}

module.exports = { scanChests, autoDeposit, bulkCollect };
