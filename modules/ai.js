// mc-bot/modules/ai.js — Claude AI 大脑模块 (支持 OpenAI 兼容 API)
const { GoalNear, GoalBlock } = require('mineflayer-pathfinder').goals;
const { escapeWater, resetStuckTimer } = require('./anti-stuck');
const think = require('./thinklog');

let apiKey = null;
let apiUrl = null;
let model = null;
let ownerName = 'player';
let conversationHistory = [];
const MAX_HISTORY = 16;

function buildSystemPrompt(owner) {
  return `You are Claude_Bot, a Minecraft robot. You LIVE inside the game world. You ARE the bot character — not an assistant outside the game.

Player "${owner}" is your owner. When ${owner} says "你" (you), they are talking to YOU, the bot. When they ask "你有X吗", they mean "Do YOU (the bot) have X in YOUR inventory?" — always check your OWN inventory first.

CRITICAL: You can see your inventory in the "Inv" field of the game state. You can see enchanted books in "EnchBooks". Use the inventory tool to check what you have. NEVER say "I can't check your backpack" — the player is asking about YOUR backpack, not theirs.

Talk naturally in Chinese. Be friendly, helpful, and playful.

## Response Rules
To chat: respond with plain text (it will be sent to Minecraft chat).
To act: respond ONLY with this JSON format (no other text):
{"chat":"your message","actions":[{"tool":"name","args":{}}]}

## Available Tools
- chat: say something. args: {"message":"..."}
- come: go to player. args: {"player":"${owner}"}
- stop: stop all tasks. args: {}
- mine: mine blocks. args: {"block":"coal_ore","count":5}
- collect: collect blocks. args: {"block":"oak_log","count":10}
- chop_tree: chop nearest tree. args: {}
- goto: go to coords. args: {"x":100,"y":64,"z":200}
- status: report HP/food/position. args: {}
- inventory: check YOUR (bot's) inventory. args: {}
- drop: drop items. args: {"item":"cobblestone"}
- equip_sword/equip_axe/equip_pickaxe: args: {}
- attack: attack mob. args: {"mob":"zombie"}
- wander: toggle auto-wander. args: {}
- scout: scan for rare ores. args: {}
- enchant: enchant YOUR item with an enchanted book using anvil. args: {"item":"sword","enchant":"sharpness"}
- search_web: search the internet to learn something. args: {"query":"how to find diamonds in minecraft 1.21"}
- find_village: try to locate a village via command or exploration. args: {}
- explore: pick a direction and walk exploring new terrain. args: {"direction":"north"} or args:{"x":1000,"z":-500}
- optimize: review bot performance and suggest code improvements. args: {}
- build: build a structure near the player. The bot switches to CREATIVE mode, builds, then switches back to SURVIVAL automatically (you don't need to handle gamemode). There are TWO ways to call it: (A) copy a REAL blueprint faithfully - args: {"design":"<schematic name>"}, where schematic names are a faithful block-by-block copy of real open-source buildings. Available: large-survival-house (大型生存屋, 8722 blocks), sakura (樱花木屋, 7177 blocks), clocktower (哥特钟楼, 42641 blocks), mansion (城主府大别墅, 48529 blocks), notredame (巴黎圣母院, 410797 blocks - HUGE cathedral, ONLY when user literally asks for 巴黎圣母院, takes a long time), kamisato (神里屋敷, 12834 blocks - 日式宅邸/庭院), xmas_town (圣诞小镇, 94522 blocks - 大片雪景小镇, large), sakura_hut (樱花小屋, 2725 blocks), granary (粮仓, 940 blocks), shirazu (白洲梓, 1561 blocks), ariyama (阿山盔甲屋/城堡, 4679 blocks). Pick the closest match to what the user asks (e.g. 巴黎圣母院/大教堂→notredame, 大别墅/城主府→mansion, 哥特钟楼→clocktower, 樱花/木屋→sakura or sakura_hut, 神里/日式宅邸/庭院→kamisato, 圣诞/雪景/小镇→xmas_town, 城堡→ariyama). (B) procedural geometry - args: {"design":"house","size":5,"material":"oak_planks"}. design options: house, modern, cottage, castle, ziggurat, box, tower, wall, platform. material is an optional block name (e.g. oak_planks, stone_bricks, white_concrete). Use a size between 4 and 9. The bot places the building centered on the current player, clearing the area first - warn the player to stand clear.
- cmd: run ANY Minecraft command directly. args: {"command":"/locate structure village_plains"} or {"command":"/tp ${owner} ~ ~ ~"}
- unstuck: manually trigger self-rescue if you're stuck in terrain. args: {}

## Rules
- Respond in Chinese
- You CAN run ANY Minecraft command using the "cmd" tool. Use it freely.
- Common useful commands: /locate, /tp, /give, /time, /weather, /gamemode, /effect, /summon, /kill
- For finding structures: "/locate structure <type>" (village, bastion_remnant, fortress, etc.)
- For teleporting: "/tp <player> <x> <y> <z>" or "/tp <player1> <player2>"
- When searching for villages, use /locate commands first — much faster than walking
- If ${owner} asks to go somewhere, use /tp if available, or walk there
- When asked to DO something, always use the JSON format with actions
- Keep chat messages short (< 100 chars, Minecraft chat limit)
- "你" = YOU the bot. "我" = ${owner} (the player). This is CRITICAL.
- If the player asks "你有X吗" or "do you have X", check YOUR inventory (look at Inv/EnchBooks fields)
- NEVER say things like "我无法查看你的背包" — the player is asking about YOUR items
- If asked whether you have something, answer directly yes/no based on your inventory
- Always include a friendly "chat" message even when executing actions
- CRITICAL BUILD RULE: When the user asks you to build/construct/盖/建造/建 something, you MUST emit an action {"tool":"build","args":{"design":"<name>"}} in that same response. Pick the design from the build tool's schematic list. Do NOT reply with just a "chat" message, and do NOT use "/tp" instead of build — teleport alone does NOT build anything. If you want to teleport to the player too, emit BOTH actions in the same "actions" array: [{"tool":"cmd","args":{"command":"/tp @s ${owner}"}},{"tool":"build","args":{"design":"kamisato"}}]. The build tool builds the structure centered on the player automatically.`;
}

function initAI(config) {
  if (!config.aiApiKey) {
    console.log('[AI] 未配置 AI API Key，使用本地命令模式');
    return false;
  }

  apiKey = config.aiApiKey;
  apiUrl = config.aiApiUrl || 'https://api.deepseek.com/v1/chat/completions';
  model = config.aiModel || 'deepseek-chat';
  ownerName = config.owner || 'player';
  console.log(`[AI] AI 大脑已就绪 (${apiUrl})`);
  return true;
}

async function processMessage(username, message, bot, state, config) {
  if (!apiKey) return null;

  const isOwner = username === config.owner;
  const isMentioned = message.toLowerCase().includes('claude');

  if (!isOwner && !isMentioned) return null;

  const gameContext = buildGameContext(bot, state);

  // 思考日志：展示这次 AI 收到的输入
  think.header('🤖 Claude_Bot 思考过程');
  think.userMessage(username, message);
  think.contextIn('上下文', gameContext);

  // 构建消息
  const messages = [
    { role: 'system', content: buildSystemPrompt(ownerName) },
    ...conversationHistory,
    { role: 'user', content: `[Player ${username}] ${message}\n\nCurrent state: ${gameContext}` },
  ];

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[AI] HTTP ${response.status}: ${errText.slice(0, 200)}`);
      bot.chat('My brain hit an error... try again?');
      return null;
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content?.trim();

    if (!rawText) {
      console.error('[AI] Empty response:', JSON.stringify(data).slice(0, 300));
      return null;
    }

    console.log(`[AI] Response: ${rawText.slice(0, 150)}`);

    // 解析响应
    let parsed;
    try {
      // 尝试提取 JSON（可能包含在 markdown 代码块中）
      let jsonStr = rawText;
      const jsonMatch = rawText.match(/\{[\s\S]*"actions"[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
      parsed = JSON.parse(jsonStr);
    } catch {
      // 纯文本回复
      parsed = { chat: rawText, actions: [] };
    }

    if (typeof parsed === 'string') {
      parsed = { chat: parsed, actions: [] };
    }
    if (!parsed.chat && parsed.actions) {
      parsed.chat = 'OK!';
    }

    // 思考日志：展示 AI 原始回复 + 动作清单
    think.rawReply(rawText);
    think.actionList(parsed);

    // 更新对话历史
    conversationHistory.push({ role: 'user', content: message });
    conversationHistory.push({ role: 'assistant', content: rawText });
    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }

    // 发送聊天
    if (parsed.chat) {
      think.finalChat(parsed.chat);
      bot.chat(parsed.chat);
    }

    // 执行动作
    if (parsed.actions && parsed.actions.length > 0) {
      if (!state.stats.actionHistory) state.stats.actionHistory = [];
      for (const action of parsed.actions) {
        try {
          think.actionStart(action.tool, action.args);
          await executeAction(action, bot, state, config);
          think.actionOk(action.tool);
          state.stats.actionHistory.push({
            time: Date.now(),
            action: action.tool,
            detail: JSON.stringify(action.args).slice(0, 100),
            success: true,
          });
        } catch (e) {
          think.actionFail(action.tool, e.message);
          console.error(`[AI] Action error (${action.tool}):`, e.message);
          state.stats.actionHistory.push({
            time: Date.now(),
            action: action.tool,
            detail: e.message.slice(0, 100),
            success: false,
          });
        }
      }
      // 只保留最近 100 条记录
      if (state.stats.actionHistory.length > 100) {
        state.stats.actionHistory = state.stats.actionHistory.slice(-100);
      }
    }

    think.rule();
    think.end();
    return parsed;
  } catch (err) {
    console.error('[AI] Error:', err.message);
    return null;
  }
}

function buildGameContext(bot, state) {
  const pos = bot.entity.position;
  const hp = Math.round(bot.health);
  const food = Math.round(bot.food);
  const mode = state.mode;
  const task = state.currentTask || 'none';
  const items = bot.inventory.items().slice(0, 8).map(i => `${i.count}x ${i.name}`).join(', ') || 'empty';
  const nearby = Object.values(bot.entities)
    .filter(e => e.type === 'mob' && e.position.distanceTo(pos) < 16)
    .slice(0, 5)
    .map(e => `${e.name || e.mobType}(${Math.round(e.position.distanceTo(pos))}m)`)
    .join(', ') || 'none';

  // 附魔书信息
  const books = bot.inventory.items()
    .filter(i => i.name === 'enchanted_book')
    .map(i => {
      try {
        const enchants = i.enchants || [];
        return enchants.map(e => `${e.name}:${e.lvl}`).join('+') || 'book';
      } catch { return 'book'; }
    })
    .join(', ') || 'none';

  // 上次搜索结果
  const searchInfo = state._lastSearchResult
    ? `[Q:${state._lastSearchResult.query} → ${state._lastSearchResult.result.slice(0, 100)}]`
    : 'none';

  // 动作统计
  const history = state.stats.actionHistory || [];
  const recentActions = history.slice(-5).map(a => `[${a.success ? '✓' : '✗'} ${a.action}]`).join(' ') || 'none';

  return `Pos:(${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}) HP:${hp} Food:${food} Mode:${mode} Task:${task} Inv:[${items}] Nearby:[${nearby}] EnchBooks:[${books}] Search:${searchInfo} Recent:[${recentActions}]`;
}

async function executeAction(action, bot, state, config) {
  const { tool, args = {} } = action;
  console.log(`[AI Action] ${tool}:`, JSON.stringify(args));

  switch (tool) {
    case 'chat':
      bot.chat(args.message);
      break;

    case 'come': {
      const playerName = args.player || config.owner;
      const player = bot.players[playerName]?.entity;
      if (!player) { bot.chat(`I can't find ${playerName}!`); break; }

      // 水中先行上岸
      if (escapeWater(bot, state)) break;

      // 保存目标给 anti-stuck 使用
      const target = player.position;
      state._lastGotoTarget = { x: target.x, y: target.y, z: target.z };
      resetStuckTimer();

      // 使用 navigator 的带超时导航
      const { navigateTo } = require('./navigator');
      state.mode = 'navigating';
      state.currentTask = `Going to ${playerName}`;
      navigateTo(target.x, target.y, target.z, bot, { timeout: 60000 })
        .then(() => {
          if (state.mode === 'navigating') state.mode = 'idle';
          state.currentTask = null;
        })
        .catch((err) => {
          console.log('[AI] come 导航失败:', err.message);
          if (state.mode === 'navigating') state.mode = 'idle';
          state.currentTask = null;
          bot.chat(`来不了了！${err.message}`);
        });
      break;
    }

    case 'stop': {
      const { stopWandering } = require('./wander');
      bot.pathfinder.setGoal(null);
      if (bot.collectBlock) bot.collectBlock.cancelTask();
      state.mode = 'idle';
      state.currentTask = null;
      state._wanderEnabled = false;
      state._lastGotoTarget = null;
      resetStuckTimer();
      stopWandering();
      break;
    }

    case 'mine': {
      // 木头类用 lumberjack 砍树模块（chopping 模式，不受 anti-stuck 干扰）
      if (isWoodBlock(args.block)) {
        if (state.mode === 'chopping') break;
        bot.pathfinder.setGoal(null);
        try { bot.stopDigging(); } catch (_) {}
        state.mode = 'chopping';
        state.currentTask = `Mining ${args.block}`;
        const { chopNearestTree: cnt } = require('./lumberjack');
        cnt(bot, state).then(count => {
          console.log(`[Mine] Chopped ${count} ${args.block}`);
          state.mode = 'idle';
          state.currentTask = null;
        });
      } else {
        if (state.mode === 'mining') break;
        bot.pathfinder.setGoal(null);
        try { bot.stopDigging(); } catch (_) {}
        if (bot.collectBlock) bot.collectBlock.cancelTask();
        state.mode = 'mining';
        state.currentTask = `Mining ${args.block}`;
        const { startMiner } = require('./miner');
        startMiner(args.block, bot, state, config, args.count || 0);
      }
      break;
    }

    case 'collect': {
      // 木头类用 lumberjack 砍树模块
      if (isWoodBlock(args.block)) {
        if (state.mode === 'chopping') break;
        bot.pathfinder.setGoal(null);
        try { bot.stopDigging(); } catch (_) {}
        state.mode = 'chopping';
        state.currentTask = `Collecting ${args.block}`;
        const { chopNearestTree: ct } = require('./lumberjack');
        ct(bot, state).then(count => {
          console.log(`[Collect] Chopped ${count} ${args.block}`);
          state.mode = 'idle';
          state.currentTask = null;
        });
      } else {
        if (state.mode === 'mining') break;
        bot.pathfinder.setGoal(null);
        try { bot.stopDigging(); } catch (_) {}
        if (bot.collectBlock) bot.collectBlock.cancelTask();
        state.mode = 'mining';
        state.currentTask = `Collecting ${args.block}`;
        const { startMiner: sm } = require('./miner');
        sm(args.block, bot, state, config, args.count || 0);
      }
      break;
    }

    case 'chop_tree': {
      if (state.mode === 'chopping') break;
      bot.pathfinder.setGoal(null);
      try { bot.stopDigging(); } catch (_) {}
      state.mode = 'chopping';
      state.currentTask = 'Chopping tree';
      const { chopNearestTree } = require('./lumberjack');
      chopNearestTree(bot, state).then(count => {
        console.log(`[Tree] Done, chopped ${count} logs`);
        state.mode = 'idle';
        state.currentTask = null;
      });
      break;
    }

    case 'goto': {
      // 水中先行上岸
      if (escapeWater(bot, state)) break;

      const tx = args.x, ty = args.y || bot.entity.position.y, tz = args.z;
      state._lastGotoTarget = { x: tx, y: ty, z: tz };
      resetStuckTimer();

      const { navigateTo: navTo } = require('./navigator');
      state.mode = 'navigating';
      state.currentTask = `Going to (${tx},${ty},${tz})`;
      bot.chat(`出发去 (${Math.round(tx)},${Math.round(ty)},${Math.round(tz)})`);
      navTo(tx, ty, tz, bot, { timeout: 90000 })
        .then(() => {
          if (state.mode === 'navigating') state.mode = 'idle';
          state.currentTask = null;
          bot.chat(`到达目的地！`);
        })
        .catch((err) => {
          console.log('[AI] goto 导航失败:', err.message);
          if (state.mode === 'navigating') state.mode = 'idle';
          state.currentTask = null;
          bot.chat(`走不到目标: ${err.message}`);
        });
      break;
    }

    case 'status': {
      const p = bot.entity.position;
      bot.chat(`HP:${Math.round(bot.health)} Food:${Math.round(bot.food)} (${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}) ${state.currentTask || 'idle'}`);
      break;
    }

    case 'inventory': {
      const items = bot.inventory.items();
      if (items.length === 0) { bot.chat('Bag empty!'); break; }
      bot.chat(items.slice(0, 8).map(i => `${i.count}x ${i.name}`).join(', '));
      break;
    }

    case 'drop': {
      const item = bot.inventory.items().find(i => i.name.includes(args.item));
      if (item) bot.tossStack(item, () => {});
      else bot.chat(`No ${args.item} in bag.`);
      break;
    }

    case 'equip_sword':
    case 'equip_axe':
    case 'equip_pickaxe': {
      const toolType = tool.split('_')[1];
      const items = bot.inventory.items().filter(i => i.name.includes(toolType));
      if (items.length === 0) { bot.chat(`No ${toolType}!`); break; }
      const rank = { netherite: 5, diamond: 4, iron: 3, stone: 2, golden: 1, wooden: 1 };
      items.sort((a, b) => (Object.entries(rank).find(([k]) => b.name.includes(k))?.[1] || 0) - (Object.entries(rank).find(([k]) => a.name.includes(k))?.[1] || 0));
      bot.equip(items[0], 'hand').then(() => bot.chat(`Holding ${items[0].name}`)).catch(() => {});
      break;
    }

    case 'attack': {
      if (state.mode === 'combat') break;
      const lower = (args.mob || '').toLowerCase();
      const target = Object.values(bot.entities).find(e =>
        e !== bot.entity && e.type === 'mob' && (e.name || e.mobType || '').toLowerCase().includes(lower)
      );
      if (!target) { bot.chat(`附近没看到 ${args.mob}。用 !near 看看周围有什么。`); break; }
      // 用完整战斗逻辑（追踪/追击/连击/超时），不依赖 bot.pvp 插件
      require('./combat').startCombat(bot, state, target);
      break;
    }

    case 'wander': {
      const { startWandering, stopWandering } = require('./wander');
      state._wanderEnabled = !state._wanderEnabled;
      if (state._wanderEnabled) startWandering(bot, state, config, config.owner);
      else stopWandering();
      bot.chat(state._wanderEnabled ? 'Wandering on.' : 'Wandering off.');
      break;
    }

    case 'scout': {
      const ores = ['diamond_ore', 'deepslate_diamond_ore', 'ancient_debris', 'emerald_ore'];
      let found = false;
      for (const name of ores) {
        const b = bot.findBlock({ matching: blk => blk.name === name, maxDistance: 128 });
        if (b) { bot.chat(`${name}: (${b.position.x},${b.position.y},${b.position.z})`); found = true; }
      }
      if (!found) bot.chat('No rare ores in 128 blocks.');
      break;
    }

    case 'enchant': {
      if (state.mode === 'enchanting' || state.mode === 'mining') break; // 防止重复
      const { enchantItem: ei } = require('./anvil');
      ei(bot, args.item, args.enchant || null, state);
      break;
    }

    case 'search_web': {
      bot.chat(`搜索: ${args.query}...`);
      const { searchWeb } = require('./web-learner');
      searchWeb(args.query).then(result => {
        state._lastSearchResult = { query: args.query, result: result.slice(0, 500) };
        bot.chat(`搜索完成！${result.slice(0, 80)}...`);
      }).catch((e) => {
        console.log('[Web] 搜索失败（可能网络不通）:', e.message);
        state._lastSearchResult = { query: args.query, result: '搜索不可用，用已有知识回答' };
      });
      break;
    }

    case 'find_village': {
      bot.chat('正在用 /locate 查找最近的村庄...');
      const { GoalNear } = require('mineflayer-pathfinder').goals;

      // 方案1: 用 /locate 命令
      bot.chat('/locate structure minecraft:village_plains');
      bot.chat('/locate structure minecraft:village_taiga');
      bot.chat('/locate structure minecraft:village_savanna');
      bot.chat('/locate structure minecraft:village_desert');
      bot.chat('/locate structure minecraft:village_snowy');

      // 方案2: 同时启动探索模式
      state.mode = 'exploring';
      state.currentTask = 'Searching for village';
      const dirs = ['north', 'south', 'east', 'west'];
      const dir = dirs[Math.floor(Math.random() * 4)];
      const pos = bot.entity.position;
      const offsets = { north: [0, -200], south: [0, 200], east: [200, 0], west: [-200, 0] };
      const [dx, dz] = offsets[dir];
      bot.pathfinder.setGoal(new GoalNear(pos.x + dx, pos.y, pos.z + dz, 1));
      bot.chat(`同时往${dir}方向探索200格...`);

      // 等一会看 locate 有没有结果
      setTimeout(() => {
        if (state.mode === 'exploring') {
          state.mode = 'idle';
          state.currentTask = null;
          bot.chat('村庄搜索已启动。如果看到 /locate 结果请告诉我坐标！');
        }
      }, 12000);
      break;
    }

    case 'explore': {
      if (escapeWater(bot, state)) break;

      const pos = bot.entity.position;
      let tx, tz;

      if (args.x !== undefined && args.z !== undefined) {
        tx = args.x; tz = args.z;
      } else {
        const dirs = { north: [0, -300], south: [0, 300], east: [300, 0], west: [-300, 0] };
        const [dx, dz] = dirs[args.direction] || dirs[Object.keys(dirs)[Math.floor(Math.random() * 4)]];
        tx = pos.x + dx; tz = pos.z + dz;
      }

      state._lastGotoTarget = { x: tx, y: pos.y, z: tz };
      resetStuckTimer();

      const { navigateTo: nv } = require('./navigator');
      state.mode = 'exploring';
      state.currentTask = `Exploring (${Math.round(tx)}, ${Math.round(tz)})`;
      bot.chat(`出发探索！目标: (${Math.round(tx)}, ${Math.round(tz)})`);
      nv(tx, pos.y, tz, bot, { timeout: 120000 })
        .then(() => {
          if (state.mode === 'exploring') state.mode = 'idle';
          state.currentTask = null;
          bot.chat('探索到达！附近有什么有趣的？');
        })
        .catch((err) => {
          console.log('[AI] explore 导航失败:', err.message);
          if (state.mode === 'exploring') state.mode = 'idle';
          state.currentTask = null;
          bot.chat(`探索失败: ${err.message}`);
        });
      break;
    }

    case 'unstuck': {
      resetStuckTimer();
      bot.pathfinder.setGoal(null);
      bot.setControlState('jump', true);
      bot.chat('尝试自救...');
      setTimeout(() => {
        bot.setControlState('jump', false);
        state.mode = 'idle';
        state.currentTask = null;
      }, 3000);
      break;
    }

    case 'optimize': {
      bot.chat('正在自检优化...');
      const fs = require('fs');
      const path = require('path');
      // 读取最近的死亡报告
      const reportsDir = path.join(__dirname, '..', 'data', 'death-reports');
      let deathSummary = '无死亡记录';
      try {
        const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 5);
        if (files.length > 0) {
          const reports = files.map(f => JSON.parse(fs.readFileSync(path.join(reportsDir, f), 'utf8')));
          deathSummary = reports.map(r => `[${r.timestamp}] ${r.mode}/${r.task} at (${r.position.x},${r.position.y},${r.position.z})`).join('\n');
        }
      } catch (_) {}

      // 收集动作统计
      const actionStats = (state.stats.actionHistory || []);
      const total = actionStats.length;
      const success = actionStats.filter(a => a.success).length;
      const fail = total - success;
      const commonFails = actionStats.filter(a => !a.success).slice(-5).map(a => `${a.action}: ${a.detail}`).join(', ');

      const summary = `Bot 运行统计:\n` +
        `动作总数: ${total} | 成功: ${success} | 失败: ${fail}\n` +
        `最近失败: ${commonFails || '无'}\n` +
        `死亡记录:\n${deathSummary}`;

      // 写入优化建议文件
      const optDir = path.join(__dirname, '..', 'data');
      const optFile = path.join(optDir, 'optimization-suggestions.md');
      fs.writeFileSync(optFile, `# 优化建议 — ${new Date().toISOString()}\n\n${summary}\n\n## 待优化项\n\n- [ ] 由 AI 审查后自动填充\n`);
      bot.chat(`自检完成！建议已写入 data/optimization-suggestions.md (${success}/${total} 成功)`);
      break;
    }

    case 'build': {
      const design = args.design || args.shape || 'house'; // 兼容旧 shape 字段
      const sizeStr = String(args.size || 5);
      const material = args.material || null;
      // 开始建造：builder 内部会切创造→建房→切回生存
      state.mode = 'building';
      state.currentTask = `Building: ${design} ${sizeStr}`;
      const { startBuilder } = require('./builder');
      // fire-and-forget 但必须捕获错误，否则 async 异常会变 unhandledRejection 崩掉整个进程
      startBuilder([design, sizeStr, material], bot, state)
        .catch((e) => {
          console.error('[AI] build error:', e.message);
          if (state.mode === 'building') state.mode = 'idle';
          state.currentTask = null;
          bot.chat(`盖房子出错啦：${e.message}`);
        });
      bot.chat(`好的，我来盖个 ${design} (大小 ${sizeStr})`);
      break;
    }

    case 'cmd': {
      const command = args.command;
      if (!command) {
        bot.chat('需要提供命令参数');
        break;
      }
      console.log(`[AI Cmd] ${command}`);
      bot.chat(command);
      break;
    }

    default:
      console.log(`[AI] Unknown tool: ${tool}`);
  }
}

// === Tree helpers ===

// 判断是否为木头类方块
function isWoodBlock(blockName) {
  if (!blockName) return false;
  return blockName.endsWith('_log') || blockName.endsWith('_wood') ||
         blockName.includes('planks') || blockName === 'log' || blockName === 'wood';
}

module.exports = { initAI, processMessage };
