// Adapted from Mineflayer 4.37.1 examples/inventory.js, craftItem().
// https://github.com/PrismarineJS/mineflayer/blob/03eba44f3e9cb93a0f0bf69a75938246e174dc6f/examples/inventory.js#L128-L153
// Copyright (c) 2015 Andrew Kelley. MIT; see THIRD_PARTY_NOTICES.md.
// 适配：中文名、成品数量、任务互斥和错误反馈；配方与合成由 Mineflayer 处理。
const itemNames = require('./item-names');

async function craftItem(name, count = 1, bot, state) {
  const requested = Number(count);
  if (!['number', 'string'].includes(typeof count) || !Number.isSafeInteger(requested) || requested < 1 || requested > 2304) {
    throw new Error('合成数量必须是 1–2304 的整数');
  }
  const input = String(name || '').trim();
  const normalized = (itemNames[input] || input).toLowerCase().replace(/^minecraft:/, '').replace(/\s+/g, '_');
  const item = bot.registry.itemsByName[normalized];
  if (!item) throw new Error(`未知物品：${input || '未填写'}，例如 !craft stick 4`);
  if (state._crafting || (state.mode && state.mode !== 'idle')) {
    throw new Error('正在执行其他任务，请先 !stop 再合成');
  }

  const craftingTable = bot.findBlock({
    matching: bot.registry.blocksByName.crafting_table.id,
    maxDistance: 4,
  });
  const recipe = bot.recipesFor(item.id, null, requested, craftingTable)[0];
  if (!recipe) {
    throw new Error(`无法合成 ${item.name} ×${requested}：请检查材料、配方及 4 格内的工作台`);
  }
  const operations = Math.ceil(requested / recipe.result.count);

  const task = {};
  state._crafting = task;
  state.mode = 'crafting';
  state.currentTask = `Crafting ${item.name}`;
  try {
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    await bot.craft(recipe, operations, recipe.requiresTable ? craftingTable : null);
    const produced = operations * recipe.result.count;
    bot.chat(`合成完成：${item.name} ×${produced}${produced > requested ? '（按配方产量取整）' : ''}`);
    return { item: item.name, count: produced };
  } catch (error) {
    throw new Error(`合成失败：${error.message}；可能已消耗部分材料，请检查背包`, { cause: error });
  } finally {
    if (state._crafting === task) {
      delete state._crafting;
      if (state.mode === 'crafting') {
        state.mode = 'idle';
        state.currentTask = null;
      }
    }
  }
}

module.exports = { craftItem };
