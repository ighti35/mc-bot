// mc-bot/modules/anvil.js — 铁砧附魔模块（使用 bot.transfer）
const { GoalNear } = require('mineflayer-pathfinder').goals;

const ENCHANT_ALIASES = {
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

const ITEM_ENCHANT_MAP = {
  'sword': ['sharpness', 'smite', 'bane_of_arthropods', 'knockback', 'fire_aspect', 'looting', 'unbreaking', 'mending', 'sweeping_edge'],
  'axe': ['sharpness', 'smite', 'bane_of_arthropods', 'efficiency', 'unbreaking', 'mending', 'fortune', 'silk_touch'],
  'pickaxe': ['efficiency', 'fortune', 'silk_touch', 'unbreaking', 'mending'],
  'shovel': ['efficiency', 'fortune', 'silk_touch', 'unbreaking', 'mending'],
  'hoe': ['efficiency', 'fortune', 'silk_touch', 'unbreaking', 'mending'],
  'helmet': ['protection', 'fire_protection', 'blast_protection', 'projectile_protection', 'respiration', 'aqua_affinity', 'thorns', 'unbreaking', 'mending'],
  'chestplate': ['protection', 'fire_protection', 'blast_protection', 'projectile_protection', 'thorns', 'unbreaking', 'mending'],
  'leggings': ['protection', 'fire_protection', 'blast_protection', 'projectile_protection', 'thorns', 'unbreaking', 'mending'],
  'boots': ['protection', 'fire_protection', 'blast_protection', 'projectile_protection', 'feather_falling', 'depth_strider', 'frost_walker', 'soul_speed', 'thorns', 'unbreaking', 'mending'],
  'bow': ['power', 'flame', 'infinity', 'punch', 'unbreaking', 'mending'],
  'crossbow': ['quick_charge', 'multishot', 'piercing', 'unbreaking', 'mending'],
  'trident': ['loyalty', 'impaling', 'riptide', 'channeling', 'unbreaking', 'mending'],
};

function findAnvil(bot) {
  return bot.findBlock({
    matching: (block) => block.name === 'anvil' || block.name === 'chipped_anvil' || block.name === 'damaged_anvil',
    maxDistance: 64,
  });
}

function findBestItem(bot, keyword) {
  const items = bot.inventory.items().filter(i => i.name.includes(keyword));
  if (items.length === 0) return null;
  const rank = { netherite: 5, diamond: 4, iron: 3, golden: 1, stone: 1, wooden: 1, leather: 1, chainmail: 2 };
  items.sort((a, b) => {
    const ta = Object.entries(rank).find(([k]) => a.name.includes(k))?.[1] || 0;
    const tb = Object.entries(rank).find(([k]) => b.name.includes(k))?.[1] || 0;
    return tb - ta;
  });
  return items[0];
}

function findEnchantedBook(bot, enchantKeyword) {
  if (!enchantKeyword || enchantKeyword === 'auto' || enchantKeyword === 'any') return null;
  const targetEnchant = ENCHANT_ALIASES[enchantKeyword.toLowerCase()];
  if (!targetEnchant) return null;
  const books = bot.inventory.items().filter(i => i.name === 'enchanted_book');
  for (const book of books) {
    try {
      const enchants = book.enchants || [];
      if (enchants.some(e => e.name === targetEnchant)) return book;
    } catch (_) {}
  }
  return null;
}

function findAnyEnchantedBook(bot, item) {
  const books = bot.inventory.items().filter(i => i.name === 'enchanted_book');
  if (books.length === 0) return null;
  const itemType = Object.keys(ITEM_ENCHANT_MAP).find(k => item.name.includes(k));
  const validEnchants = itemType ? ITEM_ENCHANT_MAP[itemType] : null;
  for (const book of books) {
    try {
      const enchants = book.enchants || [];
      if (enchants.length === 0) continue;
      if (validEnchants) {
        if (enchants.some(e => validEnchants.includes(e.name))) return book;
      } else {
        return book;
      }
    } catch (_) {}
  }
  return books[0];
}

/**
 * 主函数：用 bot.transfer() 操作铁砧窗口
 */
async function enchantItem(bot, itemKeyword, enchantKeyword, state) {
  if (state.mode === 'enchanting') return;

  const anvilBlock = findAnvil(bot);
  if (!anvilBlock) { bot.chat('附近64格没有铁砧！'); return; }

  const item = findBestItem(bot, itemKeyword);
  if (!item) { bot.chat(`背包里没有 ${itemKeyword}！`); return; }

  const book = (enchantKeyword && enchantKeyword !== 'auto')
    ? findEnchantedBook(bot, enchantKeyword)
    : findAnyEnchantedBook(bot, item);
  if (!book) {
    bot.chat((enchantKeyword && enchantKeyword !== 'auto')
      ? `没有 "${enchantKeyword}" 附魔书！`
      : '背包里没有可用的附魔书！');
    return;
  }

  const bookEnchants = (book.enchants || []).map(e => `${e.name}:${e.lvl}`).join(', ') || '未知';
  const itemName = item.displayName || item.name;
  bot.chat(`正在用铁砧给 ${itemName} 附魔 ${bookEnchants}...`);

  const prevMode = state.mode;
  const prevTask = state.currentTask;
  state.mode = 'enchanting';
  state.currentTask = `Enchanting ${itemName}`;

  try {
    // 走到铁砧旁
    bot.pathfinder.setGoal(new GoalNear(anvilBlock.position.x, anvilBlock.position.y, anvilBlock.position.z, 2));
    await waitNear(bot, anvilBlock.position, 3, 20000);
    bot.pathfinder.setGoal(null);
    await bot.lookAt(anvilBlock.position.offset(0.5, 0.5, 0.5));
    await sleep(400);

    // 打开铁砧
    const window = await bot.openBlock(anvilBlock);

    // 用 bot.transfer 放物品到铁砧槽位
    // 装备 → 槽0
    await transferItem(bot, window, item, 0);
    // 附魔书 → 槽1
    await transferItem(bot, window, book, 1);
    // 等服务器计算
    await sleep(600);

    // 检查结果槽（槽2）
    let resultItem = window.slots[2];
    if (!resultItem) {
      // 顺序不对，交换试试：先取回物品，再反向放
      await withdrawFromSlot(bot, window, 1);
      await withdrawFromSlot(bot, window, 0);
      await sleep(200);
      await transferItem(bot, window, book, 0);
      await transferItem(bot, window, item, 1);
      await sleep(600);
      resultItem = window.slots[2];
    }

    if (!resultItem) {
      throw new Error('铁砧无法组合这两个物品（附魔书可能不兼容此装备）');
    }

    // 取出结果（槽2）
    bot.putAway(2);
    await sleep(400);
    window.close();

    bot.chat(`附魔完成！${itemName} + ${bookEnchants}`);
  } catch (err) {
    console.error('[Anvil]', err.message);
    bot.chat(`附魔失败: ${err.message}`);
    try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch (_) {}
  } finally {
    state.mode = prevMode;
    state.currentTask = prevTask;
    bot.pathfinder.setGoal(null);
  }
}

/**
 * 用 bot.transfer 把物品从背包移到窗口槽位
 */
function transferItem(bot, window, item, destSlot) {
  return new Promise((resolve, reject) => {
    bot.transfer({
      window,
      itemType: item.type,
      metadata: item.metadata,
      count: item.count,
      nbt: item.nbt,
      sourceStart: window.inventoryStart,
      sourceEnd: window.inventoryEnd,
      destStart: destSlot,
      destEnd: destSlot + 1,
    }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * 从窗口槽位取回物品
 */
function withdrawFromSlot(bot, window, slot) {
  return new Promise((resolve, reject) => {
    bot.transfer({
      window,
      itemType: window.slots[slot].type,
      metadata: window.slots[slot].metadata,
      count: window.slots[slot].count,
      nbt: window.slots[slot].nbt,
      sourceStart: slot,
      sourceEnd: slot + 1,
      destStart: window.inventoryStart,
      destEnd: window.inventoryEnd,
    }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function waitNear(bot, targetPos, maxDist, timeout) {
  return new Promise((resolve, reject) => {
    const check = setInterval(() => {
      if (bot.entity.position.distanceTo(targetPos) < maxDist) {
        clearInterval(check); clearTimeout(to); resolve();
      }
    }, 300);
    const to = setTimeout(() => { clearInterval(check); reject(new Error('导航超时')); }, timeout);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { findAnvil, enchantItem, ENCHANT_ALIASES };
