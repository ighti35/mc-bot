// Mineflayer adapter for Mindcraft's collectBlock / craftRecipe / smeltItem skills.
// Upstream: src/agent/library/skills.js (MIT; see THIRD_PARTY_NOTICES.md).
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { inventoryCounts, smelting, fuelOutput } = require('./item-goal-data');

function createActions(bot, task) {
  const stations = new Map();
  let furnaceWindow = null;
  const check = () => task.check();
  async function safeNavigation(action) {
    const previous = bot.pathfinder.movements;
    const collectionMovements = bot.collectBlock.movements;
    if (previous) {
      const movement = Object.assign(Object.create(Object.getPrototypeOf(previous)), previous);
      movement.dontCreateFlow = true;
      movement.dontMineUnderFallingBlock = true;
      bot.pathfinder.setMovements(movement);
    }
    // collectblock 1.6.0 otherwise replaces movements and disables both safety flags.
    bot.collectBlock.movements = null;
    try { return await action(); } finally {
      bot.collectBlock.movements = collectionMovements;
      if (previous) bot.pathfinder.setMovements(previous);
    }
  }
  async function approach(block) {
    check();
    if (bot.entity.position.distanceTo(block.position) > 3) {
      await safeNavigation(() => bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2)));
    }
    check();
  }

  async function station(name) {
    check();
    let block = bot.findBlock({ matching: bot.registry.blocksByName[name].id, maxDistance: 32 });
    if (!block && stations.has(name)) {
      const saved = bot.blockAt(stations.get(name));
      if (saved?.name === name) block = saved;
    }
    if (block) {
      await approach(block);
      return block;
    }
    const item = bot.inventory.items().find(item => item.name === name);
    if (!item) throw new Error(`缺少 ${name}`);
    const origin = bot.entity.position.floored();
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) + Math.abs(dz) < 2) continue;
        const position = origin.offset(dx, 0, dz);
        const ground = bot.blockAt(position.offset(0, -1, 0));
        if (ground?.boundingBox !== 'block' || bot.blockAt(position)?.name !== 'air') continue;
        check();
        await bot.equip(item, 'hand');
        await bot.placeBlock(ground, new Vec3(0, 1, 0));
        check();
        const placed = bot.blockAt(position);
        if (placed?.name !== name) throw new Error(`${name} 放置失败`);
        stations.set(name, position);
        bot.chat(`放置 ${name}：${position.x}, ${position.y}, ${position.z}`);
        return placed;
      }
    }
    throw new Error(`没有可安全放置 ${name} 的平地`);
  }

  return {
    async collectBlock(_bot, source, quantity, exclude, output) {
      for (let i = 0; i < quantity; i++) {
        check();
        const age = bot.registry.blockLoot?.[source]?.drops.find(drop => drop.item === output && drop.blockAge != null)?.blockAge;
        const block = bot.findBlock({ matching: age == null ? bot.registry.blocksByName[source].id : b => b.name === source && Number(b.getProperties().age) >= age, maxDistance: 128 });
        if (!block) throw new Error(`附近没有 ${source}`);
        if (output === source && /leaves|grass|fern/.test(source)) {
          const shears = bot.inventory.items().find(item => item.name === 'shears');
          if (!shears) throw new Error(`采集 ${output} 需要剪刀`);
          await bot.equip(shears, 'hand');
        } else await bot.tool.equipForBlock(block, { requireHarvest: true });
        check();
        if (!block.canHarvest(bot.heldItem?.type ?? null)) throw new Error(`工具无法采集 ${source}`);
        await safeNavigation(() => bot.collectBlock.collect(block, { ignoreNoPath: false }));
        check();
      }
    },
    async craftRecipe(_bot, name, quantity) {
      check();
      const id = bot.registry.itemsByName[name].id;
      let table = null;
      let recipe = bot.recipesFor(id, null, 1, null)[0];
      if (!recipe) {
        table = await station('crafting_table');
        recipe = bot.recipesFor(id, null, 1, table)[0];
      }
      if (!recipe) throw new Error(`材料尚不足以合成 ${name}`);
      // Mindcraft ItemGoal replenishes one recipe's prerequisites then replans.
      // Clamp this batch to the quantity actually available, as craftRecipe does upstream.
      const counts = inventoryCounts(bot);
      let times = Math.ceil(quantity / recipe.result.count);
      for (const delta of recipe.delta) {
        if (delta.count < 0) times = Math.min(times, Math.floor((counts[bot.registry.items[delta.id].name] || 0) / -delta.count));
      }
      check();
      await bot.craft(recipe, times, recipe.requiresTable ? table : null);
      check();
    },
    async smeltItem(_bot, input, quantity, expectedOutput, fuelName) {
      check();
      const block = await station('furnace');
      const furnace = furnaceWindow = await bot.openFurnace(block);
      const outputName = expectedOutput || Object.keys(smelting).find(name => smelting[name] === input);
      try {
        // Do not mix this task's input with someone else's furnace contents.
        if (furnace.inputItem() || furnace.outputItem()) throw new Error('熔炉已有物品，请先清空或提供空熔炉');
        const counts = inventoryCounts(bot);
        const fuel = bot.inventory.items().find(item => fuelName ? item.name === fuelName : fuelOutput(item.name) > 0);
        const capacity = fuel ? fuelOutput(fuel.name) : 0;
        const availableInput = fuel?.name === input ? Math.floor((counts[input] || 0) * capacity / (capacity + 1)) : counts[input] || 0;
        const amount = Math.min(quantity, availableInput, Math.floor((fuel?.count || 0) * capacity));
        if (!amount) throw new Error('熔炼缺少原料或煤炭');
        check();
        await furnace.putFuel(fuel.type, null, Math.ceil(amount / capacity));
        check();
        await furnace.putInput(bot.registry.itemsByName[input].id, null, amount);
        let total = 0;
        const deadline = Date.now() + amount * 12000 + 15000;
        while (total < amount) {
          check();
          if (Date.now() > deadline) throw new Error('熔炼超时，请检查熔炉');
          const output = furnace.outputItem();
          if (output) {
            if (output.name !== outputName) throw new Error('熔炉产物与目标不符');
            const result = await furnace.takeOutput();
            total += result?.count || output.count;
          } else await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (furnace.fuelItem()) await furnace.takeFuel();
      } finally {
        // Leave pending input in the furnace on cancellation; report its location via progress.
        try { furnace.close(); } catch (_) { /* Connection may already be closed. */ }
        furnaceWindow = null;
      }
    },
    async attackNearest(_bot, mobType) {
      check();
      const entity = Object.values(bot.entities).filter(e => e.name === mobType && e.isValid !== false)
        .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
      if (!entity) throw new Error(`附近没有 ${mobType}`);
      if (!bot.pvp) bot.loadPlugin(require('mineflayer-pvp').plugin);
      const weapon = bot.inventory.items().filter(item => /_(sword|axe)$/.test(item.name))
        .sort((a, b) => ['netherite', 'diamond', 'iron', 'stone', 'copper', 'wooden', 'golden'].indexOf(a.name.split('_')[0]) - ['netherite', 'diamond', 'iron', 'stone', 'copper', 'wooden', 'golden'].indexOf(b.name.split('_')[0]))[0];
      if (weapon) await bot.equip(weapon, 'hand');
      try {
        bot.pvp.attack(entity);
        while (bot.entities[entity.id] && entity.isValid !== false) {
          check();
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      } finally { await bot.pvp.stop(); }
      check();
      await new Promise(resolve => setTimeout(resolve, 250));
      check();
      const drops = Object.values(bot.entities).filter(e => e.name === 'item' && e.position.distanceTo(entity.position) < 8);
      if (drops.length) await safeNavigation(() => bot.collectBlock.collect(drops));
      check();
      return true;
    },
    async smithItem(_bot, output, recipe, quantity) {
      const table = await station('smithing_table');
      const window = await bot.openBlock(table);
      try {
        if (window.type !== 'minecraft:smithing' || window.slots.length !== 40) throw new Error('锻造窗口布局不兼容，需要 1.20+ 的四槽锻造台');
        // prismarine-windows still describes the pre-1.20 three-slot layout.
        // The server supplies 40 slots: template/base/addition/result + 36 inventory.
        window.inventoryStart = 4; window.inventoryEnd = 40; window.hotbarStart = 31; window.craftingResultSlot = 3;
        if (window.slots.slice(0, 4).some(Boolean)) throw new Error('锻造台中已有物品');
        for (let i=0; i<quantity; i++) {
          check();
          for (const [slot, name] of [recipe.template, recipe.base, recipe.addition].entries()) {
            await bot.transfer({ window, itemType: bot.registry.itemsByName[name].id, metadata: null, count: 1, sourceStart: 4, sourceEnd: 40, destStart: slot, destEnd: slot + 1 });
            check();
          }
          const deadline = Date.now() + 10000;
          while (window.slots[3]?.name !== output) {
            check();
            if (Date.now() > deadline) throw new Error(`锻造 ${output} 未返回预期结果`);
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          await bot.putAway(3);
        }
      } finally { window.close(); }
    },
    async explore(source, attempt) {
      check();
      const pos = bot.entity.position;
      const directions = [[16, 0], [0, 16], [-16, 0], [0, -16]];
      const [dx, dz] = directions[attempt % directions.length];
      const underground = source.includes('diamond') || source.includes('iron') || source.includes('coal');
      // Pathfinder handles stair steps and safe digging; never dig straight down.
      const y = underground ? Math.max(-54, Math.floor(pos.y) - 8) : Math.floor(pos.y);
      await safeNavigation(() => bot.pathfinder.goto(new goals.GoalNear(Math.floor(pos.x) + dx, y, Math.floor(pos.z) + dz, 3)));
      check();
    },
    cancel() {
      for (const cleanup of [
        () => bot.pathfinder.setGoal(null),
        () => bot.collectBlock?.cancelTask(),
        () => furnaceWindow?.close(),
        () => bot.pvp?.stop(),
        () => bot.clearControlStates(),
      ]) {
        try { const pending = cleanup(); if (pending?.catch) pending.catch(() => {}); } catch (_) { /* Disconnected. */ }
      }
    },
  };
}

module.exports = { createActions };
