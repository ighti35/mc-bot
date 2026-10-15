// mc-bot/modules/chat.js — Chat & Command System
const pathfinder = require('mineflayer-pathfinder');
const { GoalNear, GoalBlock, GoalXZ } = pathfinder.goals;
const fs = require('fs');
const path = require('path');
const { startWandering, stopWandering } = require('./wander');
const { processMessage, rememberCommand } = require('./ai');
const { stopCurrentTask } = require('./task-control');
const { runCraftingTask } = require('./crafting-task');
const { craftItem } = require('./crafting');
const { obtainItem } = require('./item-goal');
const { describeItem } = require('./item-goal-data');
const { detectGameModeRequest, runGameModeTask } = require('./game-mode');
const { detectLocateRequest, locateAndGuide } = require('./locate');
const {executeWithFallback}=require('./command-assist');
const commandPermissions=require('./command-permissions');
const {resolvePlayer}=require('./player-targets');
const {huntPlayer,detectPlayerAttack}=require('./player-combat');

const HELP_MSG = [
  '========== Claude AI Commands ==========',
  '!help - Show this help',
  '!come - Come to you',
  '!hunt [玩家] - 持续追击并攻击；!stop 停止',
  '!commands - 查看授权；说“这次可以用指令”仅授权下一次任务',
  '!follow - Follow you / stop following',
  '!stop - Stop current task',
  '!wander - Toggle auto-wander near you',
  '!mine <block> [count] [targeted] - 先锁定坐标开矿道；targeted 仅挖已加载目标',
  '!branch <ore> [count] [Y] [direction] - 按矿层开阶梯和分支矿道',
  '!explore <direction> [distance] - 分段探路并记录地形/资源',
  '!village - 定位村庄并带路；!biome <群系名> - 定位目标群系并带路',
  '!locate <structure|biome> <目标> - 仅定位并返回真实坐标',
  '!back - 沿最新路线返程；!route - 查看矿道和探路记录',
  '!surface - 修步行阶梯并带主人返回露天地面',
  '!find <item> - Find nearby resources',
  '!collect <item> [count] - Collect items (e.g. !collect oak_log 20)',
  '!drops - 查看附近掉落物；!pickup [item] - 拾取地上的物品',
  '!craft <item> [count] [place] - 合成；加 place 会放置一个成品',
  '!place <item> - 放置背包里的方块（支持 工作台）',
  '!goto <x y z> - Go to coordinates',
  '!home / !gohome - Set/go home',
  '!status - Bot status',
  '!inv - Show inventory',
  '!gamemode survival - 切换自己的游戏模式并等待服务器确认',
  '!drop <item> - Drop items',
  '!sword / !axe / !pickaxe - Get best tool',
  '!enchant <item> [附魔] - 用铁砧附魔装备',
  '!kill <mob> - Attack a mob',
  '!tree [count] - 用斧头砍树并收集指定数量原木',
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
  if (require('./build-protection').isBuilding(state) && username !== config.owner) return Promise.resolve();
  const msg = message.trim();

  // Only explicit commands bypass the API. All ordinary language, including
  // cancellation during a task, is interpreted by the configured model.
  const command = msg.startsWith('!');
  const [cmd, ...args] = command ? msg.slice(1).split(/\s+/) : [];
  if (config.owner && username !== config.owner && !(command && cmd.toLowerCase() === 'help')) {
    bot.chat(`Sorry, only ${config.owner} can command me.`);
    return Promise.resolve();
  }
  if (command) {
    if (cmd.toLowerCase() === 'stop') { cmdStop(bot,state); return Promise.resolve(); }
    const permissionReply = commandPermissions.request(username, msg, state, config, bot);
    if (permissionReply) { bot.chat(permissionReply); return Promise.resolve(); }
    return Promise.resolve().then(() => commandPermissions.withAuthorization(username,msg,bot,state,config,() => handleCommand(cmd.toLowerCase(), args, username, bot, state, config)))
      .then(result => {
        if (result?.message) {
          state._lastActionResult = { tool: cmd, success: true, message: result.message };
          bot.chat(result.message);
        }
        if (username === config.owner) rememberCommand(username,msg,cmd,true,result?.message);
        return result;
      })
      .catch(error => {
        state._lastActionResult = { tool: cmd, success: false, message: error.message };
        bot.chat(`操作失败：${error.message}`);
      });
  }
  return processMessage(username, msg, bot, state, config).then(result => {
    if (result === null) bot.chat('AI 接口未配置或暂时不可用，无法理解这条请求；未执行任何本地猜测操作。');
  });
}

function fallbackAction(cmd,args,username,bot) {
  const item=args[0]?(resolveItemName(args[0])||args[0]):undefined;
  if(cmd==='come')return {tool:'come',args:{player:username}};
  if(cmd==='goto'&&args.length>=3&&args.slice(0,3).every(value=>Number.isFinite(Number(value))))return {tool:'goto',args:{x:Number(args[0]),y:Number(args[1]),z:Number(args[2])}};
  if(cmd==='back')return {tool:'back',args:{}};
  if(['mine','collect'].includes(cmd))return {tool:cmd,args:{block:item,count:Number(args[1]??16),strategy:args[2]||'auto'}};
  if(cmd==='tree')return {tool:'chop_tree',args:{count:Number(args[0]??1)}};
  if(['craft','place'].includes(cmd))return {tool:cmd,args:{item,count:Number(args[1]??1),place:args.includes('place')}};
  if(cmd==='village')return {tool:'find_village',args:{}};
  if(cmd==='biome')return {tool:'find_biome',args:{target:args[0]}};
  if(cmd==='explore'&&args[0]&&!['north','south','east','west','北','南','东','西'].includes(args[0]))return {tool:'locate',args:{kind:/^(村庄|village)$/i.test(args[0])?'structure':'biome',target:args[0]}};
  if(cmd==='explore')return {tool:'explore',args:{direction:args[0]||'north',distance:Number(args[1]??96)}};
  return null;
}

function handleCommand(cmd, args, username, bot, state, config) {
  if ((state.mode !== 'idle' || state._itemGoal || state._enchanting || state._crafting) && !['stop','help','status','inv','inventory','recipe','配方','route','drops','commands'].includes(cmd)) {
    throw new Error('已有任务正在执行，请先停止当前任务。');
  }
  switch (cmd) {
    case 'obtain':
    case '获取': return obtainItem(args[0], args[1] ?? 1, bot, state);
    case 'recipe':
    case '配方': {
      const input = args.join(' ');
      const name = require('./item-names')[input] || input;
      bot.chat(describeItem(bot, name)); return;
    }
    case 'surface': return require('./surface-guide').guideToSurface(bot,state,config);
    case 'gamemode': return runGameModeTask(bot,state,config,args[0]);

    case 'hunt':return huntPlayer(bot,state,config,{player:args[0]||username});
    case 'help':
      for (const line of HELP_MSG) {
        bot.chat(line);
      }
      break;

    case 'come':
      return cmdCome(username, bot, state);

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
      return cmdMine(args[0], bot, state, Number(args[1] ?? 0), config, { strategy: args[2] || 'auto' });

    case 'branch':
      return cmdMine(args[0], bot, state, Number(args[1] ?? 16), config, {
        strategy: 'branch', y: args[2] === undefined ? undefined : Number(args[2]), direction: args[3] || 'east',
      });

    case 'explore':
      if (args[0] && !['north','south','east','west','北','南','东','西'].includes(args[0])) return locateAndGuide(bot,state,config,{kind:/^(村庄|village)$/i.test(args[0])?'structure':'biome',target:args[0]});
      return require('./exploration').exploreTerrain(bot, state, config, { direction: args[0] || 'north', distance: Number(args[1] ?? 96) });

    case 'village':
      return locateAndGuide(bot,state,config,{kind:'structure',target:'village'});
    case 'biome':
      return locateAndGuide(bot,state,config,{kind:'biome',target:args[0]});
    case 'locate':
      return locateAndGuide(bot,state,config,{kind:args[0],target:args[1],guide:false});

    case 'back':
      return require('./navigation').returnAlongTrail(bot, state);

    case 'route':
      return { message: `矿道：${state._lastMiningPlan ? `${state._lastMiningPlan.label} Y=${state._lastMiningPlan.y} ${state._lastMiningPlan.phase} ${state._lastMiningPlan.mined}/${state._lastMiningPlan.targetCount}` : '暂无'}；目标：${state._lastMiningPlan?.lockedTarget ? `(${state._lastMiningPlan.lockedTarget.x},${state._lastMiningPlan.lockedTarget.y},${state._lastMiningPlan.lockedTarget.z}) ${state._lastMiningPlan.lockedTarget.status}` : '暂无'}；返程节点：${(state._lastExpeditionRoute || state._lastNavigationTrail)?.points?.length || 0}。` };

    case 'find':
      cmdFind(args[0], bot, state);
      break;

    case 'collect':
      return cmdMine(args[0], bot, state, args[1] === undefined ? 0 : Number(args[1]), config, { strategy: 'nearby' });

    case 'drops': {
      const summary = require('./item-pickup').describeDroppedItems(bot);
      return { message: summary === 'none' ? '附近 16 格内没有可见掉落物。' : `附近掉落物：${summary}` };
    }

    case 'pickup':
      return require('./item-pickup').runPickupTask(bot, state, { item: args[0] ? (resolveItemName(args[0]) || args[0]) : undefined });

    case '合成':
    case 'craft':
      if (args.some(a => ['place', '--place', '放置'].includes(a))) return cmdCraftOrPlace('craft', args, bot, state);
      return craftItem(args[0], args[1] ?? 1, bot, state);

    case 'goto':
      if (!args[0]) { bot.chat('Usage: !goto <x> <y> <z> or !goto <name>'); return; }
      if (isNaN(args[0])) {
        return cmdGotoSaved(args[0], bot, state);
      } else {
        const [x, y, z] = args.map(Number);
        if (isNaN(x) || isNaN(y) || isNaN(z)) { bot.chat('Usage: !goto <x> <y> <z>'); return; }
        return cmdGoto(x, y, z, bot, state);
      }
      break;

    case 'home':
      state.home = bot.entity.position.clone();
      bot.chat(`Home set at (${Math.round(state.home.x)}, ${Math.round(state.home.y)}, ${Math.round(state.home.z)})`);
      break;

    case 'gohome':
      if (!state.home) { bot.chat('No home set. Use !home first.'); return; }
      return cmdGoto(state.home.x, state.home.y, state.home.z, bot, state);

    case 'build':
      if (args.length < 1) { bot.chat('Usage: !build <design> <size> [material]  or  !build large-survival-house'); return; }
      return cmdBuild(args, bot, state);

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
      return require('./lumberjack').collectWood(bot, state, config, args[0] === undefined ? 0 : Number(args[0]));

    case 'dig':
      cmdDig(bot);
      break;

    case 'place':
      return cmdCraftOrPlace('place', args, bot, state);

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

    case '附魔':
    case 'enchant': return cmdEnchant(args, bot, state);

    default:
      bot.chat(`Unknown command: ${cmd}. Type !help for all commands.`);
  }
}

// === Command Implementations ===

function cmdCome(username, bot, state) {
  const player = resolvePlayer(bot,username);
  if (!player) { bot.chat('I cannot find you!'); return; }
  if (!state) { bot.chat('请使用 !come，我会安全寻路过来。'); return; }
  return require('./navigation-task').goTo(bot, state, player.position.clone(), { timeout: 120000, range: 2, allowTower: true, getTarget:()=>resolvePlayer(bot,username)?.position });
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
    if (state._gameInventoryTask) { clearInterval(followInterval); followTarget = null; followInterval = null; return; }
    if (state.mode !== 'idle' || state._digTask) return;
    const player = resolvePlayer(bot,username);
    if (player) {
      bot.pathfinder.setGoal(new GoalNear(player.position.x, player.position.y, player.position.z, global.config?.maxFollowDistance ?? 2));
    }
  }, 1000);
}

function cmdStop(bot, state) {
  if (state._crafting) { bot.chat('Mineflayer 合成不支持中途取消，请等待当前批次完成。'); return; }
  clearInterval(followInterval);
  followTarget = null;
  followInterval = null;
  stopCurrentTask(bot, state);
  bot.chat('All tasks stopped.');
}

async function cmdCraftOrPlace(tool, args, bot, state) {
  if (state._aiRequest) throw new Error('正在处理上一条指令，请稍等；可先用 !stop 取消。');
  const item = args[0] || (tool === 'place' ? bot.heldItem?.name : null);
  if (!item) throw new Error(`用法：!${tool} <物品名>，例如 !${tool} 工作台`);
  const placeFlag = value => ['place', '--place', '放置'].includes(value);
  const count = args[1] && !placeFlag(args[1]) ? Number(args[1]) : 1;
  const result = await runCraftingTask(tool, { item, count, place: args.some(placeFlag) }, bot, state);
  state._lastActionResult = { tool, success: true, message: result.message };
  bot.chat(result.message);
}

function cmdWander(username, bot, state, config) {
  if (state._aiRequest || state._craftTask) {
    bot.chat('正在处理任务，请先发 !stop，再切换漫游。');
    return;
  }
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

function cmdMine(target, bot, state, count, config, options = {}) {
  if (!target) { bot.chat('Usage: !mine <ore_name> [count] (e.g. !mine iron_ore 10)'); return; }
  const blockName = resolveItemName(target);
  if (!blockName) { bot.chat(`Cannot recognize: ${target}`); return; }
  bot.chat(count > 0 ? `Searching and mining ${count}x ${blockName}...` : `Searching and mining ${blockName}...`);
  const { startMiner } = require('./miner');
  return startMiner(blockName, bot, state, config, count, options);
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
  return require('./navigation-task').goTo(bot, state, { x, y, z });
}

function cmdGotoSaved(name, bot, state) {
  let waypoints = {};
  try { waypoints = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'waypoints.json'), 'utf8')); } catch {}
  const wp = waypoints[name];
  if (!wp) { bot.chat(`No saved waypoint: ${name}`); return; }
  bot.chat(`Going to "${name}" (${Math.round(wp.x)}, ${Math.round(wp.y)}, ${Math.round(wp.z)})...`);
  return cmdGoto(wp.x, wp.y, wp.z, bot, state);
}

function cmdBuild(args, bot, state) {
  commandPermissions.requireAllowed(bot,state);
  state.mode = 'building';
  state.currentTask = `Building: ${args.join(' ')}`;
  const { startBuilder } = require('./builder');
  return startBuilder(args, bot, state);
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
  const item = args[0] || bot.heldItem?.name;
  if (!item) { bot.chat('用法：!enchant <物品> [附魔] [等级]；装备和附魔书须在背包中。'); return; }
  return require('./anvil').enchantItem(bot, item, args.slice(1).join(' ') || null, state);
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
  if (global.itemNames?.[lower]) return global.itemNames[lower];
  return lower;
}

module.exports = { handleChat };
