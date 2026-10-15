// Registry adapters for Mindcraft ItemGoal; vanilla cooking/smithing snapshot is version pinned.
const vanilla = require('./game-data/vanilla-1.21.11.json');
const toolTiers = ['wooden', 'stone', 'copper', 'iron', 'diamond', 'netherite'];
const smelting = Object.fromEntries(Object.entries(vanilla.cooking).map(([name, inputs]) => [name, inputs[0]]));
const fuelOutput = name => name === 'coal' || name === 'charcoal' ? 8 : name === 'stick' ? 0.5 : /(_planks|_log|_wood)$/.test(name) && !/^(crimson|warped)/.test(name) ? 1.5 : 0;

function inventoryCounts(bot) {
  const counts = {};
  for (const item of bot.inventory.items()) counts[item.name] = (counts[item.name] || 0) + item.count;
  return counts;
}
function itemSatisfied(bot, name, quantity = 1, prerequisite = false) {
  const counts = inventoryCounts(bot);
  if ((counts[name] || 0) >= quantity) return true;
  if (!prerequisite) return false;
  if (['crafting_table', 'furnace', 'smithing_table'].includes(name)) {
    return Boolean(bot.findBlock({ matching: bot.registry.blocksByName[name].id, maxDistance: 32 }));
  }
  if (!name.endsWith('_pickaxe')) return false;
  const tier = toolTiers.indexOf(name.split('_')[0]);
  return tier >= 0 && toolTiers.slice(tier).some(material => (counts[`${material}_pickaxe`] || 0) >= quantity);
}
const natural = name => /(?:_log|_wood|_stem|_hyphae|_ore|_leaves|_sapling|_tulip|_roots|_fungus|_mushroom|_coral|_coral_fan|_terracotta)$/.test(name) ||
  /^(?:stone|cobblestone|deepslate|cobbled_deepslate|granite|diorite|andesite|tuff|calcite|blackstone|basalt|end_stone|sand|red_sand|gravel|clay|dirt|coarse_dirt|grass_block|short_grass|tall_grass|fern|large_fern|dead_bush|podzol|mycelium|netherrack|soul_sand|soul_soil|obsidian|crying_obsidian|ancient_debris|glowstone|sugar_cane|bamboo|cactus|wheat|carrots|potatoes|beetroots|pumpkin|melon|cocoa|nether_wart|sweet_berry_bush|vine|cave_vines|kelp|dandelion|poppy|blue_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|moss_block|moss_carpet|amethyst_cluster|snow_block)$/.test(name);

function createData(bot) {
  const registry = bot.registry;
  const { Recipe } = require('prismarine-recipe')(registry);
  const cache = new Map();
  const matchingVersion = (bot.version || registry.version.minecraftVersion) === vanilla.version;
  const fuels = Object.keys(registry.itemsByName).filter(name => fuelOutput(name) > 0);
  const blocks = Object.values(registry.blocksByName).filter(block => natural(block.name));
  const sources = new Map();
  for (const block of blocks) {
    for (const id of block.drops || []) {
      const name = registry.items[id]?.name;
      if (name) { if (!sources.has(name)) sources.set(name, []); sources.get(name).push(block.name); }
    }
    for (const drop of registry.blockLoot?.[block.name]?.drops || []) {
      // Loot conditions for silk touch are not represented by minecraft-data's summary.
      // Only add plants/crops and shears-supported leaves beyond ordinary block drops.
      if ((drop.blockAge != null || /leaves|grass|fern|melon|berry/.test(block.name)) && registry.itemsByName[drop.item]) {
        if (!sources.has(drop.item)) sources.set(drop.item, []);
        sources.get(drop.item).push(block.name);
      }
    }
  }
  return {
    getItemCraftingRecipes(name) {
      if (cache.has(name)) return cache.get(name);
      const id = registry.itemsByName[name]?.id;
      const recipes = id == null ? [] : Recipe.find(id, null).map(recipe => {
        const inputs = {};
        for (const delta of recipe.delta) if (delta.count < 0) inputs[registry.items[delta.id].name] = -delta.count;
        return [inputs, { craftedCount: recipe.result.count, requiresTable: recipe.requiresTable }];
      });
      cache.set(name, recipes);
      return recipes;
    },
    getItemBlockSources: name => [...new Set(sources.get(name) || [])],
    getBlockTool(name, output) {
      if (name === output && /leaves|grass|fern/.test(name)) return 'shears';
      const tools = registry.blocksByName[name]?.harvestTools;
      if (!tools) return null;
      return toolTiers.map(tier => `${tier}_pickaxe`).find(tool => tools[registry.itemsByName[tool]?.id]) || null;
    },
    getItemSmeltingIngredients: name => matchingVersion ? vanilla.cooking[name] || [] : [],
    getSmithingRecipes: name => matchingVersion ? vanilla.smithing[name] || [] : [],
    getFuels: () => fuels,
    sourceCost(type, source) {
      if (type === 'hunt') return Object.values(bot.entities || {}).some(e => e.name === source && e.isValid !== false) ? 0 : Infinity;
      if (type === 'block') return bot.findBlock({ matching: registry.blocksByName[source].id, maxDistance: 128 }) ? 0 : 20;
      return 0;
    },
    getItemAnimalSources(name) {
      return Object.values(registry.entityLoot || {}).filter(entity => !['player', 'villager', 'wandering_trader', 'ender_dragon', 'wither', 'warden'].includes(entity.entity))
        .filter(entity => entity.drops.some(drop => drop.item === name)).map(entity => entity.entity);
    },
  };
}
function describeItem(bot, name) {
  if (!bot.registry.itemsByName[name]) return '未知物品';
  const data = createData(bot);
  const routes = [];
  if (data.getItemCraftingRecipes(name).length) routes.push('合成');
  if (data.getItemBlockSources(name).length) routes.push('采集');
  if (data.getItemSmeltingIngredients(name).length) routes.push('熔炼');
  if (data.getSmithingRecipes(name).length) routes.push('锻造（需要模板）');
  if (data.getItemAnimalSources(name).length) routes.push('生物掉落（需要附近有对应生物）');
  if (vanilla.chestSources[name]) routes.push(`结构战利品：${vanilla.chestSources[name].slice(0, 2).join('、')}（需提供或自行获取）`);
  return routes.join('；') || '无已接入的自动路线；可能需要交易、种植、酿造、特殊交互或创造模式';
}
module.exports = { createData, inventoryCounts, itemSatisfied, smelting, fuelOutput, describeItem };
