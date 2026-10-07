const { Vec3 } = require('vec3');

function resolveItem(bot, input) {
  const name = ({ '工作台': 'crafting_table', '合成台': 'crafting_table' })[input] || String(input || '').replace(/^minecraft:/, '').toLowerCase();
  const item = bot.registry.itemsByName[name];
  if (!item) throw new Error(`无法识别物品：${input || '未指定'}`);
  return item;
}

const countItem = (bot, name) => bot.inventory.items().filter(item => item.name === name).reduce((total, item) => total + item.count, 0);

async function craftItem(bot, itemName, count = 1, options = {}) {
  const check = options.assertActive || (() => {});
  check();
  const item = resolveItem(bot, itemName);
  if (!Number.isSafeInteger(count) || count < 1 || count > 256) {
    throw new Error('合成数量必须是 1 到 256 的整数。');
  }
  const before = countItem(bot, item.name);
  let table = null;
  let recipes = bot.recipesFor(item.id, null, count, null);

  // A table is made in the inventory grid. Convert only the logs needed for it.
  if (item.name === 'crafting_table' && recipes.length === 0) {
    for (const raw of bot.inventory.items()) {
      check();
      const wood = raw.name.replace(/^stripped_/, '');
      const plankName = wood === 'bamboo_block' ? 'bamboo_planks'
        : wood.replace(/_(log|wood|stem|hyphae)$/, '_planks');
      if (plankName === wood || !bot.registry.itemsByName[plankName]) continue;
      const plank = bot.registry.itemsByName[plankName];
      const needed = Math.max(0, 4 * count - countItem(bot, plankName));
      const batches = Math.min(raw.count, Math.ceil(needed / (wood === 'bamboo_block' ? 2 : 4)));
      for (let batch = 0; batch < batches; batch++) {
        check();
        // Prefer the recipe consuming this exact log rather than another wood type.
        const recipe = bot.recipesFor(plank.id, null, 1, null).find(recipe =>
          recipe.delta.some(delta => delta.id === raw.type && delta.count < 0));
        if (!recipe) break;
        await bot.craft(recipe, 1, null);
        check();
      }
      recipes = bot.recipesFor(item.id, null, count, null);
      if (recipes.length) break;
    }
  }

  if (!recipes.length && item.name !== 'crafting_table') {
    table = bot.findBlock({ matching: block => block.name === 'crafting_table', maxDistance: 4 });
    if (table && table.position.distanceTo(bot.entity.position) <= 4.5) {
      recipes = bot.recipesFor(item.id, null, count, table);
    }
  }
  if (!recipes.length) {
    if (item.name === 'crafting_table') throw new Error(`材料不足：制作 ${count} 个工作台需要 ${count * 4} 块可用木板；请给我木板或原木。`);
    throw new Error(`无法合成 ${item.name}：请检查材料；需要 3×3 配方时，请在我身边放一个工作台。`);
  }
  const selected = recipes[0];
  const batches = Math.ceil(count / selected.result.count);
  for (let batch = 0; batch < batches; batch++) {
    check();
    await bot.craft(selected, 1, selected.requiresTable ? table : null);
    check();
  }
  const produced = countItem(bot, item.name) - before;
  if (produced < count) throw new Error(`合成结果未确认：背包中只增加了 ${produced} 个 ${item.name}。`);
  return { success: true, item: item.name, count: produced, requestedCount: count, message: `已合成 ${produced} 个${item.name === 'crafting_table' ? '工作台' : item.name}。` };
}

async function placeItem(bot, itemName, options = {}) {
  const check = options.assertActive || (() => {});
  check();
  const item = resolveItem(bot, itemName);
  if (!bot.registry.blocksByName[item.name]) throw new Error(`${item.name} 不是可直接放置的方块。`);
  const stack = bot.inventory.items().find(stack => stack.name === item.name);
  if (!stack) throw new Error(`背包里没有 ${item.name}，请先合成或交给我。`);
  const origin = bot.entity.position.floored();
  const candidates = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const position = origin.offset(dx, dy, dz);
        const target = bot.blockAt(position);
        const above = bot.blockAt(position.offset(0, 1, 0));
        const ground = bot.blockAt(position.offset(0, -1, 0));
        if (!target || !above || !ground || !['air', 'cave_air', 'void_air'].includes(target.name)) continue;
        if (!['air', 'cave_air', 'void_air'].includes(above.name) || ground.boundingBox !== 'block') continue;
        if (['chest', 'trapped_chest', 'crafting_table', 'furnace', 'barrel', 'hopper', 'magma_block', 'campfire', 'soul_campfire'].includes(ground.name)) continue;
        const occupied = Object.values(bot.entities).some(entity => {
          if (!entity.position || entity.type === 'object') return false;
          const feet = entity.position;
          const width = (entity.width || 0.6) / 2;
          return feet.x + width > position.x && feet.x - width < position.x + 1 &&
            feet.z + width > position.z && feet.z - width < position.z + 1 &&
            feet.y < position.y + 1 && feet.y + (entity.height || 1.8) > position.y;
        });
        if (occupied) continue;
        candidates.push({ ground, position, distance: position.distanceTo(bot.entity.position) });
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  if (!candidates.length) throw new Error('身边没有安全的空地，请带我到平坦、空旷的地面。');
  const { ground, position } = candidates[0];
  check();
  await bot.equip(stack, 'hand');
  check();
  if (!['air', 'cave_air', 'void_air'].includes(bot.blockAt(position)?.name)) throw new Error('放置位置已被占用，请重试。');
  await bot.placeBlock(ground, new Vec3(0, 1, 0));
  check();
  const placed = bot.blockAt(position);
  if (placed?.name !== item.name) throw new Error(`放置未确认：目标位置没有 ${item.name}。`);
  return { success: true, item: item.name, position: { x: position.x, y: position.y, z: position.z }, message: `已将${item.name === 'crafting_table' ? '工作台' : item.name}放在 (${position.x}, ${position.y}, ${position.z})。` };
}

module.exports = { craftItem, placeItem };
