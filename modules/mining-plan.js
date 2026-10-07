// Practical default foot heights for Java 1.18+ terrain; users may override Y.
// Distribution source: https://feedback.minecraft.net/hc/en-us/articles/4415128577293-Minecraft-Java-Edition-1-18
const PROFILES = {
  diamond: { y: -58, tier: 3, label: '钻石', names: ['diamond_ore', 'deepslate_diamond_ore'] },
  iron: { y: 16, tier: 2, label: '铁', names: ['iron_ore', 'deepslate_iron_ore'] },
  copper: { y: 48, tier: 2, label: '铜', names: ['copper_ore', 'deepslate_copper_ore'] },
  gold: { y: -16, tier: 3, label: '金', names: ['gold_ore', 'deepslate_gold_ore'] },
  redstone: { y: -58, tier: 3, label: '红石', names: ['redstone_ore', 'deepslate_redstone_ore'] },
  lapis: { y: 0, tier: 2, label: '青金石', names: ['lapis_ore', 'deepslate_lapis_ore'] },
  coal: { y: 96, tier: 1, label: '煤', names: ['coal_ore', 'deepslate_coal_ore'] },
  emerald: { y: 128, tier: 3, label: '绿宝石', mountain: true, names: ['emerald_ore', 'deepslate_emerald_ore'] },
  ancient_debris: { y: 15, tier: 4, label: '远古残骸', dimension: 'the_nether', names: ['ancient_debris'] },
  nether_quartz: { y: 32, tier: 1, label: '下界石英', dimension: 'the_nether', names: ['nether_quartz_ore'] },
  nether_gold: { y: 15, tier: 1, label: '下界金', dimension: 'the_nether', names: ['nether_gold_ore'] },
};
const ALIASES = { '钻石': 'diamond', diamonds: 'diamond', '铁': 'iron', '铁矿': 'iron', iron_ingot: 'iron', raw_iron: 'iron', '铜': 'copper', copper_ingot: 'copper', raw_copper: 'copper', '金': 'gold', '黄金': 'gold', gold_ingot: 'gold', raw_gold: 'gold', '红石': 'redstone', '青金石': 'lapis', lapis_lazuli: 'lapis', '煤': 'coal', '煤炭': 'coal', '绿宝石': 'emerald', '远古残骸': 'ancient_debris', '下界合金': 'ancient_debris', netherite_ingot: 'ancient_debris', '石英': 'nether_quartz', quartz: 'nether_quartz', '下界金': 'nether_gold' };
const DIRECTIONS = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };
const directionAliases = { '北': 'north', '南': 'south', '东': 'east', '西': 'west' };
const dimensionName = value => String(value || 'overworld').replace(/^minecraft:/, '').replace(/^nether$/, 'the_nether');

function oreProfile(input, dimension = 'overworld') {
  let key = String(input || '').replace(/^minecraft:/, '').toLowerCase();
  key = ALIASES[key] || key;
  if (!PROFILES[key]) key = Object.keys(PROFILES).find(name => PROFILES[name].names.includes(key));
  if (key === 'gold' && dimensionName(dimension) === 'the_nether') key = 'nether_gold';
  return key && PROFILES[key] ? { key, ...PROFILES[key] } : null;
}

function positiveInteger(value, fallback, maximum, name) {
  const number = value ?? fallback;
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new Error(`${name}必须是 1 到 ${maximum} 的整数。`);
  return number;
}

function buildMiningPlan(bot, input, options = {}) {
  const dimension = dimensionName(bot.game?.dimension);
  const blockName = String(input || '').replace(/^minecraft:/, '');
  let profile = oreProfile(input, dimension);
  if (!profile && bot.registry.blocksByName[blockName] && require('./terrain').isNatural({name:blockName})) {
    profile = { key:blockName,names:[blockName],label:bot.registry.blocksByName[blockName].displayName || blockName,y:Math.floor(bot.entity.position.y),tier:0,ordinary:true };
  }
  if (!profile) throw new Error(`没有 ${input} 的矿层策略，请使用 nearby 扫描附近方块。`);
  if ((profile.dimension || 'overworld') !== dimension) throw new Error(`${profile.label}的这套矿层策略不适用于当前维度 ${dimension}。`);
  const minY = bot.game?.minY ?? (dimension === 'the_nether' ? 0 : -64);
  const height = bot.game?.height ?? (dimension === 'the_nether' ? 256 : 384);
  // Coal also occurs below its high-altitude peak. Avoid trying to tunnel into open sky on flat land.
  const defaultY = profile.key === 'coal' ? Math.max(16, Math.min(profile.y, Math.floor(bot.entity.position.y) - 8)) : profile.y;
  const y = options.y ?? defaultY;
  const lowestY = minY + (profile.ordinary ? 1 : 5);
  if (!Number.isInteger(y) || y < lowestY || y > minY + height - 3) throw new Error(`矿层高度必须在 ${lowestY} 到 ${minY + height - 3} 之间。`);
  const direction = directionAliases[options.direction] || options.direction || 'east';
  if (!DIRECTIONS[direction]) throw new Error('方向必须是 north、south、east 或 west。');
  if (profile.mountain && options.y === undefined) {
    const block = bot.blockAt(bot.entity.position.floored());
    const biome = require('./terrain').biomeName(bot,block);
    if (!/mountain|peak|grove|slope|meadow|windswept/.test(biome)) throw new Error('绿宝石主要在山地生成；请到山地，或明确指定矿层 Y。');
  }
  return {
    ...profile, dimension, y, direction, vector: DIRECTIONS[direction],
    mainLength: positiveInteger(options.mainLength, 24, 96, '主矿道长度'),
    branchLength: positiveInteger(options.branchLength, 12, 48, '分支长度'),
    spacing: positiveInteger(options.spacing, 4, 12, '分支间隔'),
    maxSteps: positiveInteger(options.maxSteps, 600, 1600, '开挖步数'),
  };
}

function nextStairPoint(point, targetY, direction) {
  return { x: point.x + direction.x, y: point.y + Math.sign(targetY - point.y), z: point.z + direction.z };
}

function branchEndpoints(junction, vector, length) {
  const side = { x: -vector.z, z: vector.x };
  return [-1, 1].map(sign => ({ x: junction.x + side.x * length * sign, y: junction.y, z: junction.z + side.z * length * sign }));
}

module.exports = { PROFILES, DIRECTIONS, directionAliases, dimensionName, oreProfile, buildMiningPlan, nextStairPoint, branchEndpoints };
