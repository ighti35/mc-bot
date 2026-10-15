// Adapted from Mineflayer 4.37.1 lib/plugins/anvil.js (MIT); see THIRD_PARTY_NOTICES.md.
const { GoalNear } = require('mineflayer-pathfinder').goals;
const itemNames = require('./item-names');

const ENCHANT_ALIASES = {
  '致密': 'density', '突破': 'breach', '风爆': 'wind_burst',
  '锋利': 'sharpness', 'sharpness': 'sharpness', 'sharp': 'sharpness',
  '效率': 'efficiency', 'efficiency': 'efficiency', 'eff': 'efficiency',
  '保护': 'protection', 'protection': 'protection', 'prot': 'protection',
  '耐久': 'unbreaking', 'unbreaking': 'unbreaking', 'unbr': 'unbreaking',
  '经验修补': 'mending', 'mending': 'mending',
  '时运': 'fortune', 'fortune': 'fortune',
  '精准采集': 'silk_touch', 'silk_touch': 'silk_touch', 'silk': 'silk_touch',
  '力量': 'power', 'power': 'power',
  '火矢': 'flame', 'flame': 'flame',
  '无限': 'infinity', 'infinity': 'infinity',
  '抢夺': 'looting', 'looting': 'looting',
  '火焰保护': 'fire_protection', 'fire_protection': 'fire_protection',
  '爆炸保护': 'blast_protection', 'blast_protection': 'blast_protection',
  '弹射物保护': 'projectile_protection', 'projectile_protection': 'projectile_protection',
  '摔落保护': 'feather_falling', 'feather_falling': 'feather_falling',
  '荆棘': 'thorns', 'thorns': 'thorns',
  '深海探索者': 'depth_strider', 'depth_strider': 'depth_strider',
  '冰霜行者': 'frost_walker', 'frost_walker': 'frost_walker',
  '水下呼吸': 'respiration', 'respiration': 'respiration',
  '水下速掘': 'aqua_affinity', 'aqua_affinity': 'aqua_affinity',
  '横扫': 'sweeping_edge', 'sweeping_edge': 'sweeping_edge',
  '击退': 'knockback', 'knockback': 'knockback',
  '火焰附加': 'fire_aspect', 'fire_aspect': 'fire_aspect',
  '亡灵杀手': 'smite', 'smite': 'smite',
  '节肢杀手': 'bane_of_arthropods', 'bane_of_arthropods': 'bane_of_arthropods',
  '冲击': 'punch', 'punch': 'punch',
  '忠诚': 'loyalty', 'loyalty': 'loyalty',
  '穿刺': 'impaling', 'impaling': 'impaling',
  '激流': 'riptide', 'riptide': 'riptide',
  '引雷': 'channeling', 'channeling': 'channeling',
  '多重射击': 'multishot', 'multishot': 'multishot',
  '穿透': 'piercing', 'piercing': 'piercing',
  '快速装填': 'quick_charge', 'quick_charge': 'quick_charge',
  '灵魂疾行': 'soul_speed', 'soul_speed': 'soul_speed',
  '迅捷潜行': 'swift_sneak', 'swift_sneak': 'swift_sneak',
};

// Modern books use stored_enchantments, which prismarine-item's getter does not decode.
function enchants(item, registry) {
  const component = item?.componentMap?.get(item.name === 'enchanted_book' ? 'stored_enchantments' : 'enchantments');
  const raw = component ? (component.data.enchantments || component.data) : (item?.enchants || []);
  if (!Array.isArray(raw)) return [];
  return raw.map(e => ({ name: (e.name || registry.enchantments[e.id]?.name || '').replace(/^minecraft:/, ''), lvl: e.lvl ?? e.level }))
    .filter(e => e.name && Number.isInteger(e.lvl) && e.lvl > 0);
}

function findAnvil(bot) {
  return bot.findBlock({ matching: b => ['anvil', 'chipped_anvil', 'damaged_anvil'].includes(b.name), maxDistance: 64 });
}

function findBestItem(bot, keyword) {
  keyword = itemNames[keyword] || keyword;
  const rank = ['wooden', 'golden', 'stone', 'copper', 'iron', 'diamond', 'netherite'];
  return bot.inventory.items().filter(i => i.name === keyword || i.name.endsWith(`_${keyword}`))
    .sort((a, b) => rank.indexOf(b.name.split('_')[0]) - rank.indexOf(a.name.split('_')[0]))[0];
}

function parseEnchant(keyword, registry) {
  if (!keyword || ['auto', 'any'].includes(keyword)) return {};
  const match = keyword.trim().match(/^(.*?)(?:[ _]+(\d+|I{1,3}|IV|V))?$/i);
  const name = ENCHANT_ALIASES[match[1].toLowerCase()] || match[1].toLowerCase();
  const data = registry.enchantmentsByName[name];
  if (!data) throw new Error(`未知附魔：${keyword}`);
  const level = match[2] ? (Number(match[2]) || { I: 1, II: 2, III: 3, IV: 4, V: 5 }[match[2].toUpperCase()]) : undefined;
  if (match[2] && (!Number.isInteger(level) || level < 1)) throw new Error('附魔等级必须是正整数。');
  if (level && level > data.maxLevel) throw new Error(`${name} 最高等级为 ${data.maxLevel}`);
  return { name, level };
}

function improvements(bot, item, book) {
  const current = enchants(item, bot.registry);
  return enchants(book, bot.registry).filter(e => {
    const data = bot.registry.enchantmentsByName[e.name];
    if (!data) return false;
    if (item.name !== 'enchanted_book' && !bot.registry.itemsByName[item.name]?.enchantCategories?.includes(data.category)) return false;
    if (current.some(c => c.name !== e.name && (data.exclude.includes(c.name) || bot.registry.enchantmentsByName[c.name]?.exclude.includes(e.name)))) return false;
    const old = current.find(c => c.name === e.name)?.lvl || 0;
    return Math.min(data.maxLevel, old === e.lvl ? old + 1 : Math.max(old, e.lvl)) > old;
  });
}

async function enchantItem(bot, itemKeyword, enchantKeyword, state, options = {}) {
  if (state.mode !== 'idle' || state._enchanting || state._itemGoal || state._crafting) throw new Error('请先停止当前任务再附魔。');
  const target = parseEnchant(enchantKeyword, bot.registry);
  const item = findBestItem(bot, itemKeyword);
  if (!item) throw new Error(`背包里没有 ${itemKeyword}；请先将穿戴的装备放入背包。`);
  const books = bot.inventory.items().filter(i => i.name === 'enchanted_book' && i.slot !== item.slot);
  const book = books.map(book => ({ book, gains: improvements(bot, item, book) }))
    .filter(({ gains }) => gains.some(e => (!target.name || e.name === target.name) && (!target.level || Math.min(bot.registry.enchantmentsByName[e.name].maxLevel, (enchants(item, bot.registry).find(c => c.name === e.name)?.lvl || 0) === e.lvl ? e.lvl + 1 : e.lvl) >= target.level)))
    .sort((a, b) => Math.max(...b.gains.map(e => e.lvl)) - Math.max(...a.gains.map(e => e.lvl)))[0]?.book;
  if (!book) throw new Error('没有可提升该装备的指定附魔书（可能不兼容、冲突或已达等级）。');
  const block = findAnvil(bot);
  if (!block) throw new Error('附近64格没有铁砧。');
  if (bot.currentWindow) throw new Error('请先关闭当前容器。');
  const task = { cancelled: false };
  state._enchanting = task;
  state.mode = 'enchanting';
  state.currentTask = `附魔 ${item.name}`;
  let window;
  let cost;
  const deadline = Date.now() + (options.timeoutMs || 30000);
  const check = () => {
    if (task.cancelled) throw new Error('附魔已停止。');
    if (window && bot.currentWindow !== window) throw new Error('铁砧窗口已关闭。');
    if (Date.now() > deadline) throw new Error('等待铁砧操作超时。');
  };
  const wait = async predicate => {
    while (!predicate()) { check(); await new Promise(r => setTimeout(r, 25)); }
    check();
  };
  const cancel = () => { task.cancelled = true; };
  const property = packet => {
    if (window && packet.windowId === window.id && packet.property === 0) cost = packet.value;
  };
  bot.once('death', cancel);
  bot.once('end', cancel);
  bot._client.on('craft_progress_bar', property);
  try {
    bot.chat(`正在用铁砧给 ${item.name} 使用附魔书。`);
    bot.pathfinder.setGoal(new GoalNear(block.position.x, block.position.y, block.position.z, 2));
    await wait(() => bot.entity.position.distanceTo(block.position) <= 3);
    bot.pathfinder.setGoal(null);
    check();
    window = await bot.openAnvil(block);
    check();
    if (window.slots.slice(0, 3).some(Boolean)) throw new Error('铁砧槽位非空，已取消。');
    // Translate the player's exact slots to container slots: books of different
    // components share a type and often have null NBT; type-only transfer is unsafe.
    const slot = i => window.inventoryStart + i.slot - 9;
    await bot.moveSlotItem(slot(item), 0);
    check();
    await bot.moveSlotItem(slot(book), 1);
    await wait(() => cost !== undefined && (cost >= 40 || (cost > 0 && window.slots[2])));
    const creative = bot.game.gameMode === 'creative';
    if (!creative && cost >= 40) throw new Error(`铁砧费用过高（${cost}级），生存模式无法操作。`);
    if (!creative && bot.experience.level < cost) throw new Error(`经验不足：需要 ${cost} 级，当前 ${bot.experience.level} 级。`);
    const preview = window.slots[2];
    const before = enchants(item, bot.registry);
    const after = enchants(preview, bot.registry);
    const gains = after.filter(e => e.lvl > (before.find(c => c.name === e.name)?.lvl || 0));
    if (preview.name !== item.name || !gains.some(e => (!target.name || e.name === target.name) && (!target.level || e.lvl >= target.level)) ||
        before.some(e => !after.some(c => c.name === e.name && c.lvl >= e.lvl))) {
      throw new Error('服务器结果未包含预期附魔提升，已取消。');
    }
    check();
    await bot.putAway(2);
    await wait(() => !window.slots[0] && !window.slots[1] && !window.slots[2] && bot.inventory.items().some(i =>
      i.name === item.name && after.every(e => enchants(i, bot.registry).some(c => c.name === e.name && c.lvl === e.lvl))));
    bot.chat(`附魔完成：${item.name}，${gains.map(e => `${e.name} ${e.lvl}`).join('、')}（费用 ${cost} 级）。`);
    return { item: item.name, enchants: after, cost };
  } finally {
    bot.removeListener('death', cancel);
    bot.removeListener('end', cancel);
    bot._client.removeListener('craft_progress_bar', property);
    try { if (window && bot.currentWindow === window) window.close(); } catch (_) { /* Disconnected. */ }
    bot.pathfinder.setGoal(null);
    if (state._enchanting === task) {
      delete state._enchanting;
      state.mode = 'idle';
      state.currentTask = null;
    }
  }
}

module.exports = { findAnvil, enchantItem, ENCHANT_ALIASES, enchants, findBestItem, improvements };
