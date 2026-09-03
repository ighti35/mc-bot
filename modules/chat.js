// mc-bot/modules/chat.js — Chat & Command System
const pathfinder = require('mineflayer-pathfinder');
const { GoalNear, GoalBlock, GoalXZ } = pathfinder.goals;
const fs = require('fs');
const path = require('path');
const { startWandering, stopWandering } = require('./wander');
const { processMessage } = require('./ai');

const HELP_MSG = [
  '========== Claude AI Commands ==========',
  '!help - Show this help',
  '!come - Come to you',
  '!follow - Follow you / stop following',
  '!stop - Stop current task',
  '!wander - Toggle auto-wander near you',
  '!mine <ore> [count] - Auto mine (e.g. !mine iron_ore 10)',
  '!find <item> - Find nearby resources',
  '!collect <item> [count] - Collect items (e.g. !collect oak_log 20)',
  '!goto <x y z> - Go to coordinates',
  '!home / !gohome - Set/go home',
  '!status - Bot status',
  '!inv - Show inventory',
  '!drop <item> - Drop items',
  '!sword / !axe / !pickaxe - Get best tool',
  '!enchant <item> [附魔] - 用铁砧附魔装备',
  '!kill <mob> - Attack a mob',
  '!tree - Chop a tree',
  '!dig - Dig block under feet',
  '!scout - Scan for rare ores',
  '!near - Scan surroundings',
  '!save <name> - Save waypoint',
  '!say <msg> - Make bot say something',
  '========================================',
];

let followTarget = null;
let followInterval = null;

function handleChat(username, message, bot, state, config) {
  const msg = message.trim();

  // === AI 模式：把消息发给 Claude API ===
  processMessage(username, msg, bot, state, config).then((result) => {
    if (result !== null) return; // AI 已处理，跳过本地命令

    // === 本地命令回退（无 AI 时使用）===
    if (!msg.startsWith('!')) {
      if (config.owner && username === config.owner) {
        handleCasualChat(username, msg, bot);
      }
      return;
    }

    const parts = msg.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    if (config.owner && username !== config.owner && cmd !== 'help') {
      bot.chat(`Sorry, only ${config.owner} can command me.`);
      return;
    }

    try {
      handleCommand(cmd, args, username, bot, state, config);
    } catch (e) {
      bot.chat(`Command error: ${e.message}`);
      console.error(e);
    }
  });
}

function handleCommand(cmd, args, username, bot, state, config) {
  switch (cmd) {
    case 'help':
      for (const line of HELP_MSG) {
        bot.chat(line);
      }
      break;

    case 'come':
      cmdCome(username, bot);
      break;

    case 'follow':
      cmdFollow(username, bot, state);
      break;

    case 'stop':
      cmdStop(bot, state);
      break;

    case 'wander':
      cmdWander(username, bot, state, config);
      break;

    case 'mine':
      cmdMine(args[0], bot, state, parseInt(args[1]) || 0);
      break;

    case 'find':
      cmdFind(args[0], bot, state);
      break;

    case 'collect':
      cmdCollect(args[0], bot, state, parseInt(args[1]) || 0);
      break;

    case 'goto':
      if (!args[0]) { bot.chat('Usage: !goto <x> <y> <z> or !goto <name>'); return; }
      if (isNaN(args[0])) {
        cmdGotoSaved(args[0], bot, state);
      } else {
        const [x, y, z] = args.map(Number);
        if (isNaN(x) || isNaN(y) || isNaN(z)) { bot.chat('Usage: !goto <x> <y> <z>'); return; }
        cmdGoto(x, y, z, bot, state);
      }
      break;

    case 'home':
      state.home = bot.entity.position.clone();
      bot.chat(`Home set at (${Math.round(state.home.x)}, ${Math.round(state.home.y)}, ${Math.round(state.home.z)})`);
      break;

    case 'gohome':
      if (!state.home) { bot.chat('No home set. Use !home first.'); return; }
      cmdGoto(state.home.x, state.home.y, state.home.z, bot, state);
      break;

    case 'build':
      if (args.length < 1) { bot.chat('Usage: !build <design> <size> [material]  or  !build large-survival-house'); return; }
      cmdBuild(args, bot, state);
      break;

    case 'status':
      cmdStatus(bot, state);
      break;

    case 'inventory':
    case 'inv':
      cmdInventory(bot);
      break;

    case 'drop':
      cmdDrop(args.join(' '), bot);
      break;

    case 'equip':
      cmdEquip(bot);
      break;

    case 'chat':
    case 'say':
      if (args.length === 0) { bot.chat('Usage: !say <message>'); return; }
      bot.chat(args.join(' '));
      break;

    case 'look':
      cmdLook(bot);
      break;

    case 'near':
      cmdNear(bot, state);
      break;

    case 'tree':
      cmdTree(bot, state);
      break;

    case 'dig':
      cmdDig(bot);
      break;

    case 'place':
      cmdPlace(bot);
      break;

    case 'save':
      cmdSave(args[0], bot, state);
      break;

    case 'scout':
      cmdScout(bot, state);
      break;

    case 'attack':
    case 'kill':
      cmdAttack(args[0], bot, state);
      break;

    case 'sword':
      cmdGiveSword(bot);
      break;

    case 'axe':
      cmdGiveAxe(bot);
      break;

    case 'pickaxe':
      cmdGivePickaxe(bot);
      break;

    case 'enchant':
      cmdEnchant(args, bot, state);
      break;

    default:
      bot.chat(`Unknown command: ${cmd}. Type !help for all commands.`);
  }
}

// === Command Implementations ===

function cmdCome(username, bot) {
  const player = bot.players[username]?.entity;
  if (!player) { bot.chat('I cannot find you!'); return; }
  bot.pathfinder.setGoal(new GoalNear(player.position.x, player.position.y, player.position.z, 1));
  bot.chat('Coming!');
}

function cmdFollow(username, bot, state) {
  if (followTarget === username) {
    clearInterval(followInterval);
    followTarget = null;
    followInterval = null;
    bot.pathfinder.setGoal(null);
    bot.chat('Stopped following.');
    return;
  }
  followTarget = username;
  bot.chat('Following you...');
  followInterval = setInterval(() => {
    const player = bot.players[username]?.entity;
    if (player) {
      bot.pathfinder.setGoal(new GoalNear(player.position.x, player.position.y, player.position.z, config.maxFollowDistance));
    }
  }, 1000);
}

function cmdStop(bot, state) {
  clearInterval(followInterval);
  followTarget = null;
  followInterval = null;
  bot.pathfinder.setGoal(null);
  if (bot.collectBlock) bot.collectBlock.cancelTask();
  state.currentTask = null;
  state.mode = 'idle';
  state._wanderEnabled = false;
  bot.chat('All tasks stopped.');
}

function cmdWander(username, bot, state, config) {
  if (state._wanderEnabled) {
    state._wanderEnabled = false;
    stopWandering();
    bot.pathfinder.setGoal(null);
    bot.chat('Auto-wander disabled.');
  } else {
    startWandering(bot, state, config, username);
    bot.chat(`Auto-wander enabled. I will roam within ${config.wanderRadius || 32} blocks of you. Use !stop to disable.`);
  }
}

function cmdMine(target, bot, state, count) {
  if (!target) { bot.chat('Usage: !mine <ore_name> [count] (e.g. !mine iron_ore 10)'); return; }
  const blockName = resolveItemName(target);
  if (!blockName) { bot.chat(`Cannot recognize: ${target}`); return; }
  state.mode = 'mining';
  state.currentTask = count > 0 ? `Mining ${count}x ${blockName}` : `Mining: ${blockName}`;
  bot.chat(count > 0 ? `Searching and mining ${count}x ${blockName}...` : `Searching and mining ${blockName}...`);
  const { startMiner } = require('./miner');
  startMiner(blockName, bot, state, config, count);
}

function cmdFind(itemName, bot, state) {
  if (!itemName) { bot.chat('Usage: !find <item_name>'); return; }
  const id = resolveItemName(itemName);
  const blockName = id || itemName;
  bot.chat(`Scanning for ${blockName}...`);
  const block = bot.findBlock({
    matching: (b) => b.name.includes(blockName),
    maxDistance: 64,
  });
  if (block) {
    bot.chat(`Found ${block.displayName || block.name} at (${block.position.x}, ${block.position.y}, ${block.position.z}) - ${Math.round(block.position.distanceTo(bot.entity.position))}m away`);
    const targetBlock = block.position;
    bot.pathfinder.setGoal(new GoalBlock(targetBlock.x, targetBlock.y, targetBlock.z));
  } else {
    bot.chat(`Did not find ${blockName} within 64 blocks. Try !scout for wider range.`);
  }
}

function cmdCollect(itemName, bot, state, count) {
  if (!itemName) { bot.chat('Usage: !collect <item_name> [count] (e.g. !collect oak_log 20)'); return; }
  const id = resolveItemName(itemName);
  const blockName = id || itemName;
  state.mode = 'collecting';
  state.currentTask = count > 0 ? `Collecting ${count}x ${blockName}` : `Collecting: ${blockName}`;
  bot.chat(count > 0 ? `Collecting ${count}x ${blockName}...` : `Collecting ${blockName}...`);

  let collected = 0;
  const targetCount = count > 0 ? count : Infinity;

  function collectNext() {
    if (state.mode !== 'collecting') return;
    if (collected >= targetCount) {
      bot.chat(`Done! Collected ${collected}x ${blockName}.`);
      state.mode = 'idle';
      state.currentTask = null;
      return;
    }

    // findBlock returns a Block object (not string) — collectBlock expects this
    const block = bot.findBlock({
      matching: (b) => b.name === blockName,
      maxDistance: 48,
    });

    if (!block) {
      if (collected === 0) {
        bot.chat(`Cannot find ${blockName} within 48 blocks.`);
      } else {
        bot.chat(`Collected ${collected}x ${blockName} (no more nearby).`);
      }
      state.mode = 'idle';
      state.currentTask = null;
      return;
    }

    bot.collectBlock.collect(block, { append: false }, (err) => {
      if (err) {
        if (collected === 0) {
          bot.chat(`Collect error: ${err.message}`);
        } else {
          bot.chat(`Collected ${collected}x ${blockName} (stopped: ${err.message})`);
        }
        state.mode = 'idle';
        state.currentTask = null;
        return;
      }
      collected++;
      state.stats.itemsCollected++;
      if (collected < targetCount) {
        setTimeout(collectNext, 500);
      } else {
        bot.chat(`Done! Collected ${collected}x ${blockName}.`);
        state.mode = 'idle';
        state.currentTask = null;
      }
    });
  }

  collectNext();
}

function cmdGoto(x, y, z, bot, state) {
  bot.chat(`Going to (${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)})...`);
  state.mode = 'navigating';
  state.currentTask = `Going to (${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)})`;
  bot.pathfinder.setGoal(new GoalNear(x, y, z, 1));
}

function cmdGotoSaved(name, bot, state) {
  let waypoints = {};
  try { waypoints = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'waypoints.json'), 'utf8')); } catch {}
  const wp = waypoints[name];
  if (!wp) { bot.chat(`No saved waypoint: ${name}`); return; }
  bot.chat(`Going to "${name}" (${Math.round(wp.x)}, ${Math.round(wp.y)}, ${Math.round(wp.z)})...`);
  bot.pathfinder.setGoal(new GoalNear(wp.x, wp.y, wp.z, 1));
}

function cmdBuild(args, bot, state) {
  state.mode = 'building';
  state.currentTask = `Building: ${args.join(' ')}`;
  const { startBuilder } = require('./builder');
  startBuilder(args, bot, state);
}

function cmdStatus(bot, state) {
  const pos = bot.entity.position;
  const hp = Math.round(bot.health);
  const food = Math.round(bot.food);
  const task = state.currentTask || 'None';
  bot.chat(`===== Bot Status =====`);
  bot.chat(`Position: (${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`);
  bot.chat(`HP: ${hp} | Food: ${food} | Task: ${task} | Mode: ${state.mode}`);
  bot.chat(`Mined: ${state.stats.blocksMined} | Collected: ${state.stats.itemsCollected}`);
}

function cmdInventory(bot) {
  const items = bot.inventory.items();
  if (items.length === 0) { bot.chat('Inventory is empty.'); return; }
  const list = items.slice(0, 10).map((item) => {
    const name = item.displayName || item.name;
    return `${name} x${item.count}`;
  }).join(', ');
  bot.chat(`Inventory (${items.length} types): ${list}${items.length > 10 ? '...' : ''}`);
}

function cmdDrop(itemName, bot) {
  if (!itemName) { bot.chat('Usage: !drop <item_name>'); return; }
  const item = bot.inventory.items().find((i) => i.name.includes(itemName));
  if (!item) { bot.chat(`Cannot find ${itemName} in inventory.`); return; }
  bot.tossStack(item, (err) => {
    if (err) bot.chat(`Drop failed: ${err.message}`);
    else bot.chat(`Dropped ${item.count}x ${item.displayName || item.name}`);
  });
}

function cmdEquip(bot) {
  bot.armorManager.equipAll();
  bot.chat('Equipped best armor.');
}

function cmdLook(bot) {
  const block = bot.blockAtCursor(5);
  if (!block) { bot.chat('Cannot see any block.'); return; }
  bot.chat(`Looking at: ${block.displayName || block.name} at (${block.position.x}, ${block.position.y}, ${block.position.z})`);
}

function cmdNear(bot, state) {
  const pos = bot.entity.position;
  // 列出 bot 视野内所有实体：名字 / 类型 / 坐标 / 距离
  const mobs = Object.values(bot.entities).filter(e => e !== bot.entity && e.type === 'mob').slice(0, 15);
  const distLabels = mobs.map(e => {
    const d = e.position.distanceTo(pos);
    return `${e.name || e.mobType || '?'}(${e.type}, ${Math.round(e.position.x)}, ${Math.round(e.position.y)}, ${Math.round(e.position.z)}, ${Math.round(d)}m)`;
  });
  if (mobs.length > 0) {
    bot.chat(`Mobs seen (${mobs.length}): ${distLabels.join(' | ')}`);
  } else {
    bot.chat('No mobs in my view. Try moving to where you see the sheep, the bot only sees nearby loaded chunks.');
  }
  const ores = bot.findBlocks({
    matching: (block) => block.name.endsWith('_ore') || block.name === 'ancient_debris',
    maxDistance: 32,
    count: 10,
  });
  if (ores.length > 0) {
    bot.chat(`Nearby ores: found ${ores.length} deposits`);
  }
}

function cmdTree(bot, state) {
  bot.chat('Looking for a tree...');
  const tree = bot.findBlock({
    matching: (block) => block.name.endsWith('_log') || block.name.endsWith('_wood'),
    maxDistance: 16,
  });
  if (!tree) { bot.chat('No trees nearby.'); return; }
  const woodBlocks = getTreeBlocks(bot, tree);
  bot.chat(`Found a tree! Chopping ${woodBlocks.length} blocks...`);
  state.mode = 'mining';
  state.currentTask = 'Chopping tree';
  harvestTreeBlocks(bot, woodBlocks, state);
}

function getTreeBlocks(bot, logBlock) {
  const blocks = [];
  const visited = new Set();
  const start = logBlock.position;
  const queue = [start];
  while (queue.length > 0) {
    const pos = queue.shift();
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (visited.has(key)) continue;
    visited.add(key);

    // 只处理树干/树皮/树叶
    try {
      const block = bot.blockAt(pos);
      if (block && (block.name.endsWith('_log') || block.name.endsWith('_wood') || block.name.endsWith('_leaves'))) {
        blocks.push(block);
        if (pos.distanceTo(start) < 8) {
          for (const off of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
            const next = pos.offset(off[0], off[1], off[2]);
            if (!visited.has(`${next.x},${next.y},${next.z}`)) {
              queue.push(next);
            }
          }
        }
      }
    } catch (_) { /* 区块未加载，跳过 */ }
  }

  // 只保留需要挖的方块（树干），按从高到低排序
  return blocks
    .filter(b => b.name.endsWith('_log') || b.name.endsWith('_wood'))
    .sort((a, b) => b.position.y - a.position.y);
}

function harvestTreeBlocks(bot, blocks, state) {
  let i = 0;
  function next() {
    if (i >= blocks.length) {
      bot.chat('Tree chopped!');
      state.mode = 'idle';
      state.currentTask = null;
      return;
    }
    const block = blocks[i++];
    if (bot.canDigBlock(block)) {
      bot.dig(block, (err) => {
        if (err) {
          bot.chat(`Chop error: ${err.message}`);
          state.mode = 'idle';
          state.currentTask = null;
          return;
        }
        state.stats.blocksMined++;
        setTimeout(next, 200);
      });
    } else {
      // 可能需要走到更近的地方
      bot.pathfinder.setGoal(new GoalNear(block.position.x, block.position.y, block.position.z, 2));
      setTimeout(next, 1000);
    }
  }
  next();
}

function cmdDig(bot) {
  const block = bot.blockAt(bot.entity.position.offset(0, -1, 0));
  if (!block || block.name === 'air') { bot.chat('Nothing to dig under feet.'); return; }
  bot.dig(block, (err) => {
    if (err) bot.chat(`Dig failed: ${err.message}`);
    else bot.chat(`Dug up ${block.displayName || block.name}`);
  });
}

function cmdPlace(bot) {
  const item = bot.heldItem;
  if (!item) { bot.chat('Not holding anything.'); return; }
  const refBlock = bot.blockAtCursor(5);
  if (!refBlock) { bot.chat('Cannot see a surface to place on.'); return; }
  bot.placeBlock(refBlock, refBlock.face, (err) => {
    if (err) bot.chat(`Place failed: ${err.message}`);
    else bot.chat(`Placed ${item.displayName || item.name}`);
  });
}

function cmdSave(name, bot, state) {
  if (!name) { bot.chat('Usage: !save <name>'); return; }
  const waypoints = loadWaypoints();
  waypoints[name] = {
    x: bot.entity.position.x,
    y: bot.entity.position.y,
    z: bot.entity.position.z,
    dimension: bot.game.dimension,
  };
  const wpPath = path.join(__dirname, '..', 'data', 'waypoints.json');
  fs.writeFileSync(wpPath, JSON.stringify(waypoints, null, 2));
  bot.chat(`Saved waypoint "${name}"`);
}

function cmdScout(bot, state) {
  bot.chat('Scanning for rare resources (128 block radius)...');
  const rareBlocks = ['diamond_ore', 'deepslate_diamond_ore', 'ancient_debris', 'emerald_ore', 'deepslate_emerald_ore'];
  const found = [];
  for (const blockName of rareBlocks) {
    const block = bot.findBlock({
      matching: (b) => b.name === blockName,
      maxDistance: 128,
    });
    if (block) found.push({ name: blockName, pos: block.position });
  }
  if (found.length === 0) {
    bot.chat('No rare resources found within 128 blocks.');
  } else {
    for (const f of found) {
      bot.chat(`${f.name} at (${f.pos.x}, ${f.pos.y}, ${f.pos.z}) - ${Math.round(f.pos.distanceTo(bot.entity.position))}m`);
    }
  }
}

function cmdAttack(target, bot, state) {
  if (!target) { bot.chat('Usage: !kill <mob_name>'); return; }
  const lower = target.toLowerCase();
  // 只看 mob 实体（羊/牛/猪/僵尸等都是 type=mob），排除玩家和掉落物
  const entity = Object.values(bot.entities).find((e) => {
    if (e === bot.entity) return false;
    if (e.type !== 'mob') return false;
    const nm = (e.name || e.mobType || '').toLowerCase();
    return nm === lower || nm.includes(lower) || nm.endsWith(lower);
  });
  if (!entity) { bot.chat(`Cannot find: ${target}. Use !near to see what mobs are around me.`); return; }

  const { startCombat } = require('./combat');
  bot.chat(`Attacking ${entity.name || entity.displayName || target}!`);
  startCombat(bot, state, entity);
}

// === Give Tool Commands ===

function cmdGiveSword(bot) {
  const sword = findOrCraftItem(bot, 'sword');
  if (sword) {
    bot.equip(sword, 'hand').then(() => {
      bot.chat(`Equipped ${sword.displayName || sword.name}!`);
    }).catch(() => {
      bot.chat('Failed to equip sword.');
    });
  } else {
    bot.chat('No sword in inventory! Say !give me a sword.');
  }
}

function cmdGiveAxe(bot) {
  const axe = findOrCraftItem(bot, 'axe');
  if (axe) {
    bot.equip(axe, 'hand').then(() => {
      bot.chat(`Equipped ${axe.displayName || axe.name}!`);
    }).catch(() => {
      bot.chat('Failed to equip axe.');
    });
  } else {
    bot.chat('No axe in inventory! Say !give me an axe.');
  }
}

function cmdGivePickaxe(bot) {
  const pick = findOrCraftItem(bot, 'pickaxe');
  if (pick) {
    bot.equip(pick, 'hand').then(() => {
      bot.chat(`Equipped ${pick.displayName || pick.name}!`);
    }).catch(() => {
      bot.chat('Failed to equip pickaxe.');
    });
  } else {
    bot.chat('No pickaxe in inventory! Say !give me a pickaxe.');
  }
}

// === Enchant Command ===

function cmdEnchant(args, bot, state) {
  const { enchantItem } = require('./anvil');
  if (args.length === 0) {
    // 自动模式：给所有装备逐件附魔
    autoEnchantAll(bot, state);
    return;
  }
  const itemKeyword = args[0].toLowerCase();
  const enchantKeyword = args.length >= 2 ? args.slice(1).join('_').toLowerCase() : null;
  enchantItem(bot, itemKeyword, enchantKeyword, state);
}

async function autoEnchantAll(bot, state) {
  const { enchantItem } = require('./anvil');

  // 优先附魔手持物品
  const toEnchant = [];
  if (bot.heldItem) {
    const tools = ['sword', 'pickaxe', 'axe', 'shovel', 'hoe', 'bow', 'crossbow', 'trident'];
    const match = tools.find(t => bot.heldItem.name.includes(t));
    if (match) toEnchant.push(match);
  }
  // 再加盔甲
  const armor = ['helmet', 'chestplate', 'leggings', 'boots'];
  for (const a of armor) {
    const item = bot.inventory.slots.find((s, idx) => idx >= 5 && idx <= 8 && s && s.name.includes(a));
    if (item) toEnchant.push(a);
  }

  if (toEnchant.length === 0) {
    bot.chat('没有可附魔的装备！');
    return;
  }

  bot.chat(`开始自动附魔: ${toEnchant.join(', ')}`);
  for (const keyword of toEnchant) {
    await enchantItem(bot, keyword, null, state);
    if (state.mode === 'enchanting') break; // 出错了就停
  }
  bot.chat('自动附魔完成！');
}

function findOrCraftItem(bot, toolType) {
  // 先在背包找最好的
  const items = bot.inventory.items().filter((item) => {
    return item.name.includes(`_${toolType}`) || item.name.includes(toolType);
  });

  if (items.length === 0) return null;

  const materialRank = { netherite: 5, diamond: 4, iron: 3, stone: 2, golden: 1, wooden: 1 };
  items.sort((a, b) => {
    const tierA = getMaterialRank(a.name, materialRank);
    const tierB = getMaterialRank(b.name, materialRank);
    return tierB - tierA;
  });

  return items[0];
}

function getMaterialRank(name, rankMap) {
  for (const [mat, rank] of Object.entries(rankMap)) {
    if (name.includes(mat)) return rank;
  }
  return 0;
}

function loadWaypoints() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'waypoints.json'), 'utf8')); }
  catch { return {}; }
}

function resolveItemName(input) {
  const lower = input.toLowerCase().replace(/\s/g, '_');
  if (global.itemNames[lower]) return global.itemNames[lower];
  return lower;
}

function handleCasualChat(username, msg, bot) {
  const lower = msg.toLowerCase();
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    bot.chat(`Hello ${username}! Need help? Type !help for commands.`);
  } else if (lower.includes('mine') || lower.includes('dig')) {
    bot.chat('I can mine for you! Try !mine <ore_name> or !dig to dig below me.');
  } else if (lower.includes('build')) {
    bot.chat('I can build! Try !build box 5');
  } else if (lower.includes('come') || lower.includes('here')) {
    cmdCome(username, bot);
  } else if (lower.includes('thanks') || lower.includes('thank')) {
    bot.chat('You are welcome!');
  } else {
    bot.chat(`Got it! Type !help to see what I can do.`);
  }
}

module.exports = { handleChat };
