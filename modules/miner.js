// mc-bot/modules/miner.js — 智能挖矿模块
const pathfinder = require('mineflayer-pathfinder');
const { GoalNear } = pathfinder.goals;

// 每种方块需要的最低工具等级: 0=空手, 1=木, 2=石, 3=铁, 4=钻, 5=下界合金
const TOOL_TIER = {
  iron_ore: 3, deepslate_iron_ore: 3,
  gold_ore: 3, deepslate_gold_ore: 3,
  copper_ore: 3, deepslate_copper_ore: 3,
  diamond_ore: 4, deepslate_diamond_ore: 4,
  emerald_ore: 4, deepslate_emerald_ore: 4,
  redstone_ore: 4, deepslate_redstone_ore: 4,
  lapis_ore: 3, deepslate_lapis_ore: 3,
  coal_ore: 2, deepslate_coal_ore: 2,
  ancient_debris: 5,
  netherite_block: 5,
  obsidian: 5,
};

function startMiner(blockName, bot, state, config, count) {
  if (!blockName) blockName = 'iron_ore';
  const targetCount = count > 0 ? count : Infinity;
  let mined = 0;
  const skippedPositions = new Set(); // 跳过不可达的方块，防止无限循环

  // 先切换到合适的工具（木头类用斧，矿物用镐）
  if (blockName.endsWith('_log') || blockName.endsWith('_wood') || blockName.includes('planks')) {
    equipBestAxe(bot);
  } else {
    equipBestPickaxe(bot, blockName);
  }

  const mineLoop = () => {
    if (state.mode !== 'mining') return;

    if (mined >= targetCount) {
      bot.chat(`Done! Mined ${mined}x ${blockName}.`);
      state.mode = 'idle';
      state.currentTask = null;
      return;
    }

    const remaining = targetCount === Infinity ? '∞' : (targetCount - mined);
    state.currentTask = `Mining ${blockName} (${mined}/${targetCount === Infinity ? '∞' : targetCount})`;

    const ores = bot.findBlocks({
      matching: (block) => block.name === blockName && !skippedPositions.has(`${block.position.x},${block.position.y},${block.position.z}`),
      maxDistance: 48,
      count: 10,
    });

    if (!ores || ores.length === 0) {
      const farOres = bot.findBlocks({
        matching: (block) => block.name === blockName && !skippedPositions.has(`${block.position.x},${block.position.y},${block.position.z}`),
        maxDistance: 128,
        count: 5,
      });
      if (!farOres || farOres.length === 0) {
        bot.chat(`No ${blockName} within 128 blocks (mined ${mined}/${remaining}). Searching...`);
        if (state.mode === 'mining') {
          const randX = bot.entity.position.x + (Math.random() - 0.5) * 100;
          const randZ = bot.entity.position.z + (Math.random() - 0.5) * 100;
          bot.pathfinder.setGoal(new GoalNear(randX, bot.entity.position.y, randZ, 1));
          setTimeout(mineLoop, 8000);
        }
        return;
      }
      const target = farOres[0];
      const block = bot.blockAt(target);
      if (!block) { setTimeout(mineLoop, 500); return; }
      bot.chat(`Found ore vein ${Math.round(block.position.distanceTo(bot.entity.position))}m away (${mined}/${remaining})`);
      goAndMine(bot, block, () => { mined++; mineLoop(); }, state, skippedPositions);
      return;
    }

    const target = ores[0];
    const block = bot.blockAt(target);
    if (!block) { setTimeout(mineLoop, 500); return; }
    goAndMine(bot, block, () => { mined++; mineLoop(); }, state, skippedPositions);
  };

  mineLoop();
}

function goAndMine(bot, block, callback, state, skippedPositions) {
  const pos = block.position;
  const posKey = `${pos.x},${pos.y},${pos.z}`;

  // 已经跳过过的方块，不再重试
  if (skippedPositions && skippedPositions.has(posKey)) {
    callback();
    return;
  }

  bot.pathfinder.setGoal(new GoalNear(pos.x, pos.y, pos.z, 2));

  let arrived = false;
  const checkArrived = setInterval(() => {
    if (arrived) return;
    const dist = bot.entity.position.distanceTo(pos);
    if (dist < 3.5) {
      arrived = true;
      clearInterval(checkArrived);
      setTimeout(() => mineBlock(bot, block, callback, state, skippedPositions), 400);
    }
  }, 300);

  setTimeout(() => {
    clearInterval(checkArrived);
    if (!arrived) {
      bot.pathfinder.setGoal(null); // 清理残留路径
      if (skippedPositions) skippedPositions.add(posKey); // 无法到达，标记跳过
      callback();
    }
  }, 30000);
}

function mineBlock(bot, block, callback, state, skippedPositions) {
  const posKey = `${block.position.x},${block.position.y},${block.position.z}`;

  if (!bot.canDigBlock(block)) {
    // 木头用斧子，矿物用镐子
    if (block.name.endsWith('_log') || block.name.endsWith('_wood')) {
      equipBestAxe(bot);
    } else {
      equipBestPickaxe(bot, block.name);
    }
    setTimeout(() => {
      if (!bot.canDigBlock(block)) {
        console.log(`[Miner] Cannot dig ${block.name} at ${posKey}, skipping`);
        if (skippedPositions) skippedPositions.add(posKey); // 不可达，标记
        callback();
        return;
      }
      doDig();
    }, 300);
    return;
  }
  doDig();

  function doDig() {
    try { bot.stopDigging(); } catch (_) {}
    try { bot.lookAt(block.position.offset(0.5, 0.5, 0.5)); } catch (_) {}

    const posKey = `${block.position.x},${block.position.y},${block.position.z}`;

    bot.dig(block).catch(e => {
      if (e.message !== 'Digging aborted') console.log(`[Miner] dig rejected: ${e.message}`);
    });

    const startTime = Date.now();
    const DIG_TIMEOUT = 10000;
    const poll = setInterval(() => {
      const current = bot.blockAt(block.position);
      const elapsed = Date.now() - startTime;

      // 方块消失了 = 挖成功
      if (!current || !current.name || current.name !== block.name) {
        clearInterval(poll);
        state.stats.blocksMined++;
        console.log(`[Miner] mined ${block.name} at ${posKey}`);

        const nearby = bot.findBlock({
          matching: (b) => b.name === block.name,
          maxDistance: 4,
          point: block.position,
        });
        if (nearby) {
          setTimeout(() => mineBlock(bot, nearby, callback, state, skippedPositions), 300);
        } else {
          setTimeout(callback, 300);
        }
        return;
      }

      // 超时
      if (elapsed > DIG_TIMEOUT) {
        clearInterval(poll);
        console.log(`[Miner] dig timeout for ${block.name} at ${posKey}`);
        try { bot.stopDigging(); } catch (_) {}
        callback();
      }
    }, 300);
  }
}

function equipBestPickaxe(bot, blockName) {
  const requiredTier = TOOL_TIER[blockName] || 1;
  const pickaxes = bot.inventory.items().filter((item) => {
    return item.name.includes('pickaxe') || item.name.includes('_pickaxe');
  });

  if (pickaxes.length === 0) return; // 没有镐子

  // 按等级排序
  const tierMap = { wooden: 1, stone: 2, golden: 1, iron: 3, diamond: 4, netherite: 5 };
  pickaxes.sort((a, b) => {
    const tierA = getTier(a.name, tierMap);
    const tierB = getTier(b.name, tierMap);
    return tierB - tierA;
  });

  const best = pickaxes[0];
  const bestTier = getTier(best.name, tierMap);

  if (bestTier >= requiredTier) {
    // 只有不等同才换
    if (!bot.heldItem || bot.heldItem.type !== best.type) {
      bot.equip(best, 'hand').catch(() => {});
    }
  }
}

function getTier(name, tierMap) {
  for (const [key, tier] of Object.entries(tierMap)) {
    if (name.includes(key)) return tier;
  }
  return 0;
}

function equipBestAxe(bot) {
  const axes = bot.inventory.items().filter(i => i.name.includes('_axe') || i.name.includes('axe'));
  if (axes.length === 0) return;
  const tierMap = { wooden: 1, stone: 2, golden: 1, iron: 3, diamond: 4, netherite: 5 };
  axes.sort((a, b) => getTier(b.name, tierMap) - getTier(a.name, tierMap));
  const best = axes[0];
  if (!bot.heldItem || bot.heldItem.type !== best.type) {
    bot.equip(best, 'hand').catch(() => {});
    console.log(`[Miner] Equipped axe: ${best.name}`);
  }
}

module.exports = { startMiner };
