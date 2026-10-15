// mc-bot/modules/ai.js — Claude AI 大脑模块 (支持 OpenAI 兼容 API)
const { GoalNear, GoalBlock } = require('mineflayer-pathfinder').goals;
const { escapeWater, resetStuckTimer } = require('./anti-stuck');
const think = require('./thinklog');
const { pauseWanderingForCommand, stopCurrentTask } = require('./task-control');
const { runCraftingTask } = require('./crafting-task');
const { ConversationMemory } = require('./conversation-memory');
const path = require('path');
const { currentGameMode, runGameModeTask, normalizeGameMode } = require('./game-mode');
const {executeWithFallback,runCommand,enabled:commandAssistEnabled}=require('./command-assist');
const commandPermissions=require('./command-permissions');
const {resolvePlayer,describePlayers}=require('./player-targets');

let apiKey = null;
let apiUrl = null;
let model = null;
let conversationMemory;

const SYSTEM_PROMPT = `You are Claude_Bot, a Minecraft robot. You LIVE inside the game world. You ARE the bot character — not an assistant outside the game.

Player "Owner" is your owner. When Owner says "你" (you), they are talking to YOU, the bot. When they ask "你有X吗", they mean "Do YOU (the bot) have X in YOUR inventory?" — always check your OWN inventory first.

CRITICAL: You can see your inventory in the "Inv" field of the game state. You can see enchanted books in "EnchBooks". Use the inventory tool to check what you have. NEVER say "I can't check your backpack" — the player is asking about YOUR backpack, not theirs.

Talk naturally in Chinese. Be friendly, helpful, and playful.

## Response Rules
Interpret every ordinary player message using its meaning, conversation history and current game state. There are no fixed phrases or local keyword shortcuts. Distinguish instructions from questions, negation, hypotheticals and corrections. Choose the appropriate tool and normalize item/enchantment IDs and numeric counts/levels yourself; ask a brief clarification when the target is ambiguous. Never ask the player to rephrase as a !command.
While a task is active, continue interpreting messages: cancellation uses stop, questions use chat/status/inventory, and switching tasks requires stopping the current task before starting another. A stop request may take time to settle; do not assume the task lock is released immediately.
For enchantment, use the bot's HeldItem and inventory to resolve references. Use enchant with the desired enchantment/level, or omit enchant to select a compatible book automatically. Missing books, equipment and XP are reported by the executor. Do not replace survival crafting or book/anvil requests with /give, /enchant or creative commands.
To chat: respond with plain text (it will be sent to Minecraft chat).
To act: respond ONLY with this JSON format (no other text):
{"chat":"your message","actions":[{"tool":"name","args":{}}]}

## Available Tools
- chat: say something. args: {"message":"..."}
- come: go to player. args: {"player":"Owner"}
- surface: lead the owner to the surface by building a walkable staircase. args: {}
- stop: stop all tasks. args: {}
- mine: locate real loaded target blocks, plan safe tunnels and collect veins. args: {"block":"diamond_ore","count":10,"strategy":"auto"}. Ordinary/deepslate variants both count. scanRadius32 (8..64); auto/branch use heights/branches when no targets are loaded, nearby/targeted only search loaded local blocks. Optional y,direction,mainLength,branchLength. Count is target blocks; default16. Report MinePlan honestly. If acquiring requested resources is impossible and command assistance is enabled, /give may supply the missing amount; never describe that as actual mining. A request to excavate a tunnel cannot be fulfilled by giving items.
- collect: collect blocks. args: {"block":"oak_log","count":10}
- pickup: pick up visible dropped item entities WITHOUT mining blocks. args: {"item":"oak_log","radius":12} or {} for all nearby drops. Use Dropped in current context to identify items. Unknown item metadata means visible but not yet identified; do not claim there are no drops. When asked to 捡/拾取地上物品, use pickup, not collect/mine or /give.
- chop_tree: automatically equip an axe and collect logs across trees. args: {"count":20} (omit count for one tree). For a quantity request, use ONE counted action; wait for its verified result.
- obtain: autonomously obtain an item, including gathering resources, prerequisite tools, workstations, crafting and smelting. args: {"item":"diamond_pickaxe","count":1}. Count is the desired TOTAL in bot inventory. Use this for requests to 合成/制作/获取 an item; the goal executor handles prerequisites and verifies the final inventory. Never substitute /give or creative mode. Report progress, not success before execution finishes.
- craft: immediate crafting from current inventory only. args: {"item":"stick","count":4}. Count is NEW output items. Use only if the player explicitly requests inventory-only crafting; prefer obtain for final goals.
- craft_and_place: really craft items from YOUR inventory. args: {"item":"crafting_table","count":1,"place":true}. count is desired output quantity; place=true also places ONE resulting block on nearby ground. For crafting_table this automatically turns inventory logs into planks first, then crafts a table in the 2x2 inventory grid. Missing materials cause an explicit failure.
- place: place ONE block from YOUR inventory on nearby safe ground. args: {"item":"crafting_table"}. Use this alone if you already have the block.
- goto: go to coords. args: {"x":100,"y":64,"z":200}
- status: report HP/food/position. args: {}
- inventory: check YOUR (bot's) inventory. args: {}
- drop: walk close to a player and toss the EXACT requested number of inventory items in front of them. args: {"item":"dirt","count":10,"player":"Owner"}. Always include count when the user specifies a quantity; omit count only if they ask for all of that item.
- equip_sword/equip_axe/equip_pickaxe: args: {}
- attack: attack mob. args: {"mob":"zombie"}
- attack_player: continuously chase AND melee-attack a specifically requested player; arriving nearby does NOT complete the task. args: {"player":"Owner","duration":300}. Use this for 追杀我/攻击我/打我; never substitute come or mob-only attack. Duration1..600s. It ends on death, !stop, low health, lost live target or the time limit. Owner is protected from automatic combat but may explicitly request a duel.
- wander: toggle auto-wander. args: {}
- scout: scan for rare ores. args: {}
- enchant: enchant YOUR item using an enchanted book and anvil. args: {"item":"diamond_sword","enchant":"sharpness","level":3}. Level is optional. Requires equipment/book in inventory, XP and a nearby anvil. Wait for verified completion.
- search_web: search the internet to learn something. args: {"query":"how to find diamonds in minecraft 1.21"}
- find_village: execute /locate structure #minecraft:village, await the server's real coordinates, then lead the owner there by an adaptive ground/swimming/bridge route. args: {} or {"guide":false} to only locate. Never substitute random exploration or claim beds prove a village.
- find_biome: execute /locate biome for a real named biome and lead the owner there. args: {"target":"cherry_grove"}. Chinese names are accepted. Requires server permission; report command failures honestly.
- locate: locate a structure or biome and lead there. args: {"kind":"biome","target":"desert","guide":true}. guide:false only reports verified coordinates.
- explore: survey terrain in short segments, climb small hills, detour high mountains, swim and bridge cliffs using inventory blocks. args: {"direction":"north","distance":96} or {"x":100,"z":-50}. Distance8..512, coordinates within512. Use locate tools for distant destinations. If the destination cannot be reached normally, command assistance may teleport using confirmed coordinates. Never invent destinations or claim arrival without confirmation.
- back: return along the latest recorded route, with command assistance if walking fails. args: {}
- route: report the latest mine plan and exploration/return route. args: {}
- optimize: review bot performance and suggest code improvements. args: {}
- build: build a real schematic at the bot position or resume its saved original location. Preserve the actual game mode. Commands require current permission. Native schematic names: notredame (巴黎圣母院, 410783 blocks), large-survival-house (大型生存屋), sakura (樱花木屋), clocktower (哥特钟楼), mansion (城主府), kamisato (神里屋敷), xmas_town (圣诞小镇), sakura_hut (樱花小屋), granary (粮仓), shirazu (白洲梓), ariyama (阿山盔甲屋), smallhouse, 21981. args: {"design":"notredame"}. For repairing existing stairs and nether portal blocks, use {"design":"notredame","repair":true}; this uses the saved original coordinates and never rebuilds the whole structure. Stair facing/half/shape must match the schematic. Place portal blocks after all supporting structure, using strict placement; decorative nether portal windows are restored as portal blocks, not ignited with fire. Procedural geometry args: {"design":"house","size":5,"material":"oak_planks"}; designs: house, modern, cottage, castle, ziggurat, box, tower, wall, platform. New builds preserve existing terrain unless this exact saved job has explicit human cleanup authorization.
- Maze schematic choices for build: maze-fallout (废土迷宫/辐射迷宫, 105×105 footprint, height 7, 54413 blocks), maze-vault (地下堡垒迷宫/避难所迷宫, 105×105 footprint, height 7, 48896 blocks), maze-catacombs (地下墓穴迷宫, 80×80 footprint, height 6, 33780 blocks), maze-classic (经典石砖迷宫, 100×100 footprint, height 3, 20002 blocks). For an unspecified request to build a 迷宫 or 大型迷宫, choose maze-fallout. Example: {"tool":"build","args":{"design":"maze-fallout"}}. These are installed real schematic files, not patterns to invent with raw commands.
- gamemode: change YOUR actual game mode and wait for server confirmation. args: {"mode":"survival"}. Use this when asked to switch to survival/creative/adventure/spectator. Never claim success from memory or chat alone; GameMode in current state is authoritative.
- cmd: send a Minecraft command directly. args: {"command":"/locate structure village_plains"} or {"command":"/tp Owner ~ ~ ~"}. Sending alone is not proof that the server executed it.
- unstuck: manually trigger self-rescue if you're stuck in terrain. args: {}

- Mega builds installed: anor-londo (亚诺尔隆德, 633×921 footprint, height 246), minas-tirith (米那斯提力斯/白城, 527×642 footprint, height 247), raya-lucaria (雷亚卢卡利亚魔法学院, 372×491 footprint, height 239, includes entrance bridge and local terrain). Arcania is imported as five separate real map regions: arcania (阿卡尼亚白色城堡, 401×529, height 139), arcania-black-castle (阿卡尼亚黑色城堡, 495×463, height 193), arcania-elvish-city (阿卡尼亚精灵城, 297×475, height 176), arcania-mountain-mansion (阿卡尼亚山间庄园, 353×353, height 177), arcania-mesa-stronghold (阿卡尼亚恶地要塞, 401×417, height 148). These retain surrounding terrain and foundations. The complete Arcania world archive is saved separately; the menu entries do not represent all 5000×5000 blocks of its terrain. Use the building menu to choose coordinates and check height before starting. Only leyndell (王城罗德尔) remains unavailable because the original requires incompatible Conquest Reforged custom blocks. Never substitute an invented procedural castle or raw commands for a missing requested blueprint.

## Rules
- Respond in Chinese
- Minecraft commands are allowed by default while the bot's actual server game mode is creative. In other modes, only the owner can explicitly authorize their use for the current task. An explicit prohibition overrides creative mode. CommandAssist:false forbids cmd, /give, /tp, /locate, game-mode changes, and command-based building. Failure or missing materials is NEVER implicit authorization. Explain what is missing or impossible and stop the failed action. Authorization in conversation history or a prior completed task is expired; it must never enable later tasks. With current permission, verified commands may help achieve the requested outcome.
- Common useful commands: /locate, /tp, /give, /time, /weather, /gamemode, /effect, /summon, /kill
- For finding structures: "/locate structure <type>" (village, bastion_remnant, fortress, etc.)
- For teleporting: "/tp <player> <x> <y> <z>" or "/tp <player1> <player2>"
- When asked to find a village or take the owner to a biome, use find_village/find_biome/locate. These tools await /locate results and plan the journey; do not merely send cmd or walk a random direction.
- If CommandAssist:true for this task, command help is permitted by creative mode or explicit owner authorization. Prefer normal actions; commands may be used if they cannot work. If CommandAssist:false, never substitute commands for mining, crafting or movement. For a final item goal use obtain to gather prerequisites and craft normally; craft is inventory-only. Never invent /craft. Stop/cancellation always cancels the task. Keep the requested game mode. Honor narrower restrictions such as 不准传送 even during an authorized task. Do not claim physical mining/crafting happened when commands supplied the result.
- If asked to branch mine, strip mine, 按矿层挖 or 开矿道, use mine with strategy:"branch". Report missing tools, low durability, hazards or partial results truthfully. Defaults are configurable foot heights, not a guarantee of finding ore; emerald requires mountain terrain, nether ores require the Nether.
- When asked to DO something, always use the JSON format with actions
- Keep chat messages short (< 100 chars, Minecraft chat limit)
- "你" = YOU the bot. "我" = Owner (the player). This is CRITICAL.
- If the player asks "你有X吗" or "do you have X", check YOUR inventory (look at Inv/EnchBooks fields)
- NEVER say things like "我无法查看你的背包" — the player is asking about YOUR items
- If asked whether you have something, answer directly yes/no based on your inventory
- Always include a friendly "chat" message even when executing actions
- For "挖十个泥土丢给我", use [{"tool":"mine","args":{"block":"dirt","count":10}},{"tool":"drop","args":{"item":"dirt","count":10}}]. Actions execute in order and mining waits for collection before drop. If the user only needs ten items and they are already in your inventory, you may use drop directly with count:10. Never say you gave ten while omitting count.
- For crafting or placing individual items, prefer craft/place, not build. Vanilla Minecraft has NO /craft command. If missing materials or limitations prevent completion, command assistance may give the requested item or place the requested block; report the method honestly.
- When asked "去合成工作台，放在地上", emit {"tool":"craft","args":{"item":"crafting_table","count":1,"place":true}}. If a table is already in your inventory, use place instead. Do not stop after only crafting planks. One log produces four planks; a crafting table needs four planks and no existing table.
- The chat field describes what you will TRY, never claims an action already succeeded. Actual execution results appear in LastResult and Recent. If an action failed, explain the real reason; never claim you are still doing it. If materials are missing, request them or offer to collect them first.
- CRITICAL BUILD RULE: When the user asks you to build/construct/盖/建造/建 something, you MUST emit an action {"tool":"build","args":{"design":"<name>"}} in that same response. Pick the design from the build tool's schematic list. Do NOT reply with just a "chat" message, and do NOT use "/tp" instead of build — teleport alone does NOT build anything. If you want to teleport to the player too, emit BOTH actions in the same "actions" array: [{"tool":"cmd","args":{"command":"/tp @s Owner"}},{"tool":"build","args":{"design":"kamisato"}}]. The build tool builds the structure centered on the player automatically.`;

function initAI(config) {
  if (!config.aiApiKey) {
    apiKey = null; apiUrl = null; model = null;
    console.log('[AI] 未配置 AI API Key，使用本地命令模式');
    return false;
  }

  apiKey = config.aiApiKey;
  apiUrl = config.aiApiUrl || 'https://api.deepseek.com/v1/chat/completions';
  model = config.aiModel || 'deepseek-chat';
  const scope = `${config.username || 'Claude_Bot'}:${config.owner || ''}`;
  const memoryName = require('crypto').createHash('sha256').update(scope).digest('hex').slice(0, 16);
  conversationMemory = new ConversationMemory(path.join(__dirname, '..', 'data', `conversation-${memoryName}.json`), scope);
  try { conversationMemory.importLog(path.join(__dirname, '..', 'data', 'bot.log'), config.owner); } catch (error) { console.error('[Memory] 旧日志恢复失败:', error.message); }
  console.log(`[Memory] 已恢复 ${conversationMemory.turns.length} 轮对话`);
  console.log(`[AI] AI 大脑已就绪 (${apiUrl})`);
  return true;
}

async function processMessage(username, message, bot, state, config) {
  if (!apiKey) return null;

  const isOwner = !config.owner || username === config.owner;
  const isMentioned = message.toLowerCase().includes('claude');

  if (!isOwner && !isMentioned) return null;

  pauseWanderingForCommand(bot, state);
  const gameContext = buildGameContext(bot, state, config, message);
  const epoch = state._commandEpoch || 0;
  const request = { controller: new AbortController() };
  state._aiRequests ||= new Set();
  state._aiRequests.add(request);
  state._aiRequest = request;
  if (state.mode === 'idle') {
    request.ownsThinking = true;
    state.mode = 'thinking';
    state.currentTask = '处理指令';
  }
  const assertActive = () => {
    if ((state._commandEpoch || 0) !== epoch || request.controller.signal.aborted) {
      const error = new Error('任务已停止');
      error.code = 'TASK_CANCELLED';
      throw error;
    }
  };

  // 思考日志：展示这次 AI 收到的输入
  think.header('🤖 Claude_Bot 思考过程');
  think.userMessage(username, message);
  think.contextIn('上下文', gameContext);

  // 构建消息
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT.replace(/Owner/g, config.owner) + '\nPersistent conversation history below is for memory only. Never replay past actions on restart. Historical positions/inventory may be outdated: current state is authoritative. Interrupted actions have unknown completion; never claim they succeeded. Remember previous conversations instead of claiming all memories are lost after restart.' },
    ...conversationMemory.messages(),
    { role: 'user', content: `[Player ${username}] ${message}\n\nCurrent state: ${gameContext}` },
  ];
  const memoryTurn = conversationMemory.begin(username, message);
  let releaseCommandAuthorization=()=>{};
  let memoryStatus = 'failed';

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      signal: AbortSignal.any([request.controller.signal, AbortSignal.timeout(45000)]),
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
    assertActive();
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

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      parsed = { chat: rawText, actions: [] };
    }
    if (!Array.isArray(parsed.actions)) parsed.actions = [];
    if (!parsed.chat && parsed.actions) {
      parsed.chat = 'OK!';
    }
    if (parsed.actions.some(action => action.tool === 'gamemode' || action.tool === 'cmd' && /^\/?(?:minecraft:)?gamemode\s/i.test(String(action.args?.command || '').trim()))) {
      parsed.chat = '正在切换游戏模式，等待服务器确认。';
    }

    // 思考日志：展示 AI 原始回复 + 动作清单
    think.rawReply(rawText);
    think.actionList(parsed);

    // 更新对话历史
    conversationMemory.reply(memoryTurn, rawText);

    // 发送聊天
    if (parsed.chat) {
      assertActive();
      think.finalChat(parsed.chat);
      bot.chat(parsed.chat);
    }

    if (state._aiRequest === request) state._aiRequest = null;
    if (request.ownsThinking && state.mode === 'thinking' && !state._commandTask) { state.mode = 'idle'; state.currentTask = null; }
    // 执行动作
    if (parsed.actions && parsed.actions.length > 0) {
      if (!isOwner) throw new Error('只有主人可以执行操作');
      state.stats ||= {};
      if(parsed.actions.some(action=>!['chat','status','inventory','route','scout','search_web','optimize'].includes(action.tool)))releaseCommandAuthorization=commandPermissions.begin(username,message,bot,state,config);
      if (!state.stats.actionHistory) state.stats.actionHistory = [];
      for (const action of parsed.actions) {
        assertActive();
        try {
          think.actionStart(action.tool, action.args);
          const run = () => executeAction(action,bot,state,config,assertActive);
          const result = ['obtain','enchant','craft'].includes(action.tool) ? await run() : await executeWithFallback(action,bot,state,config,run,assertActive,{message});
          if (action.tool !== 'stop') assertActive();
          think.actionOk(action.tool, result?.message || '');
          state._lastActionResult = { tool: action.tool, success: true, message: result?.message || '动作已调用' };
          conversationMemory.result(memoryTurn, action.tool, true, result?.message || '动作已调用');
          if (result?.message) bot.chat(result.message);
          state.stats.actionHistory.push({
            time: Date.now(),
            action: action.tool,
            detail: (result?.message || JSON.stringify(action.args || {})).slice(0, 100),
            success: true,
          });
          if (action.tool === 'stop') break;
        } catch (e) {
          if (e.code === 'TASK_CANCELLED') throw e;
          think.actionFail(action.tool, e.message);
          console.error(`[AI] Action error (${action.tool}):`, e.stack || e.message);
          state._lastActionResult = { tool: action.tool, success: false, message: e.message };
          conversationMemory.result(memoryTurn, action.tool, false, e.message);
          bot.chat(`执行失败：${e.message}`.slice(0, 200));
          state.stats.actionHistory.push({
            time: Date.now(),
            action: action.tool,
            detail: e.message.slice(0, 100),
            success: false,
          });
          // A failed prerequisite must not be followed by placement or other dependent actions.
          break;
        }
      }
      // 只保留最近 100 条记录
      if (state.stats.actionHistory.length > 100) {
        state.stats.actionHistory = state.stats.actionHistory.slice(-100);
      }
    }

    think.rule();
    think.end();
    memoryStatus = memoryTurn.results.some(result => !result.success) ? 'failed' : 'complete';
    return parsed;
  } catch (err) {
    if (err.code === 'TASK_CANCELLED' || request.controller.signal.aborted) {
      memoryStatus = 'cancelled';
      return { chat: '', actions: [], cancelled: true };
    }
    console.error('[AI] Error:', err.message);
    return null;
  } finally {
    state._aiRequests.delete(request);
    releaseCommandAuthorization();
    conversationMemory.finish(memoryTurn, memoryStatus);
    if (state._aiRequest === request) {
      state._aiRequest = null;
      if (state.mode === 'thinking') {
        state.mode = 'idle';
        state.currentTask = null;
      }
    }
  }
}

function buildGameContext(bot, state, config=global.config||{}, message='') {
  const pos = bot.entity.position;
  const hp = Math.round(bot.health);
  const food = Math.round(bot.food);
  const mode = state.mode;
  const gameMode = currentGameMode(bot) || 'unknown';
  const task = `${state.currentTask || 'none'} Players:[${describePlayers(bot,config.owner)}]`;
  const assistance=`CommandAssist:${commandAssistEnabled(config,message,state,bot)||!commandPermissions.denied(message)&&!commandPermissions.restricted(state)&&commandPermissions.pending(state,config.owner)} CommandPermission:${bot._inventoryCanGive===true?'available':'unknown'} LastCommandFallback:${JSON.stringify(state._lastCommandFallback||null)}`;
  const items = bot.inventory.items().map(i => `${i.count}x ${i.name}`).join(', ') || 'empty';
  const dropped = require('./item-pickup').describeDroppedItems(bot, { radius: 16, maxItems: 24 });
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
        const enchants = require('./anvil').enchants(i, bot.registry);
        return enchants.map(e => `${e.name}:${e.lvl}`).join('+') || 'book';
      } catch { return 'book'; }
    })
    .join(', ') || 'none';

  // 上次搜索结果
  const searchInfo = state._lastSearchResult
    ? `[Q:${state._lastSearchResult.query} → ${state._lastSearchResult.result.slice(0, 100)}]`
    : 'none';

  // 动作统计
  const history = state.stats?.actionHistory || [];
  const recentActions = history.slice(-5).map(a => `[${a.success ? '✓' : '✗'} ${a.action}: ${a.detail || ''}]`).join(' ') || 'none';

  return `${assistance} Pos:(${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}) HP:${hp} Food:${food} GameMode:${gameMode} Mode:${mode} Task:${task} Located:${JSON.stringify(state._lastLocatedTarget || null)} HeldItem:${bot.heldItem?.name || 'none'} XP:${bot.experience?.level ?? 'unknown'} Inv:[${items}] Nearby:[${nearby}] Dropped:[${dropped}] EnchBooks:[${books}] Search:${searchInfo} Recent:[${recentActions}] LastResult:${JSON.stringify(state._lastActionResult || null)} MinePlan:${JSON.stringify(state._lastMiningPlan || null)} Exploration:${JSON.stringify(state._lastExplorationResult || null).slice(0, 1000)}`;
}

async function executeAction(action, bot, state, config, assertActive = () => {}) {
  const { tool, args = {} } = action;
  console.log(`[AI Action] ${tool}:`, JSON.stringify(args));

  if ((state.mode !== 'idle' && state.mode !== 'thinking' || state._itemGoal || state._enchanting || state._crafting) && !['chat','status','inventory','stop','route'].includes(tool)) throw new Error('已有任务正在执行，请先停止当前任务。');
  switch (tool) {
    case 'surface': return require('./surface-guide').guideToSurface(bot,state,config);
    case 'obtain': return require('./item-goal').obtainItem(args.item, args.count ?? 1, bot, state);

    case 'chat':
      bot.chat(args.message);
      break;

    case 'come': {
      const playerName = args.player || config.owner;
      const player = resolvePlayer(bot,playerName);
      if (!player) throw new Error(`找不到 ${playerName}，请靠近我。`);
      return require('./navigation-task').goTo(bot, state, player.position.clone(), { assertActive, timeout: 120000, range: 2, allowTower: true, getTarget:()=>resolvePlayer(bot,playerName)?.position });
    }

    case 'stop': {
      stopCurrentTask(bot, state);
      break;
    }

    case 'gamemode':
      return runGameModeTask(bot, state, config, args.mode, assertActive);

    case 'craft':
      if (!args.place) return require('./crafting').craftItem(args.item, args.count ?? 1, bot, state);
      return runCraftingTask('craft',args,bot,state,assertActive);
    case 'craft_and_place': return runCraftingTask('craft',{...args,place:true},bot,state,assertActive);
    case 'place':
      return runCraftingTask(tool, args, bot, state, assertActive);

    case 'mine':
    case 'collect': {
      if (isWoodBlock(args.block)) {
        return await require('./lumberjack').collectWood(bot, state, config, args.count ?? 0, args, assertActive);
      }
      const { startMiner } = require('./miner');
      return await startMiner(args.block, bot, state, config, args.count ?? 0, { ...args, strategy: args.strategy || (tool === 'collect' ? 'nearby' : 'auto') });
    }

    case 'chop_tree':
      return await require('./lumberjack').collectWood(bot, state, config, args.count ?? 0, args, assertActive);

    case 'pickup':
      return await require('./item-pickup').runPickupTask(bot, state, args, assertActive);

    case 'goto': {
      return require('./navigation-task').goTo(bot, state, { x: args.x, y: args.y ?? bot.entity.position.y, z: args.z }, { assertActive, timeout: 90000 });
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
      return require('./item-transfer').dropItem(bot, state, config, args, assertActive);
    }

    case 'equip_sword':
    case 'equip_axe':
    case 'equip_pickaxe': {
      const toolType = tool.split('_')[1];
      const items = bot.inventory.items().filter(i => i.name.endsWith('_' + toolType));
      if (items.length === 0) { bot.chat(`No ${toolType}!`); break; }
      const rank = { netherite: 5, diamond: 4, iron: 3, stone: 2, golden: 1, wooden: 1 };
      items.sort((a, b) => (Object.entries(rank).find(([k]) => b.name.includes(k))?.[1] || 0) - (Object.entries(rank).find(([k]) => a.name.includes(k))?.[1] || 0));
      await require('./task-control').waitForAction(bot.equip(items[0], 'hand'), { assertActive, timeout: 5000 });
      if (bot.heldItem?.name !== items[0].name) throw new Error('没有确认工具已装备。');
      return { message: `已装备 ${items[0].name}` };
      break;
    }

    case 'attack': {
      if(args.player||resolvePlayer(bot,args.mob))return require('./player-combat').huntPlayer(bot,state,config,{player:args.player||args.mob},assertActive);
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

    case 'attack_player':return require('./player-combat').huntPlayer(bot,state,config,args,assertActive);

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
      const { enchantItem: ei } = require('./anvil');
      return ei(bot, args.item, [args.enchant,args.level].filter(v => v != null).join(' ') || null, state);
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
      return require('./locate').locateAndGuide(bot,state,config,{...args,kind:'structure',target:'village'},assertActive);
    }

    case 'find_biome':
      return require('./locate').locateAndGuide(bot,state,config,{...args,kind:'biome',target:args.target||args.biome},assertActive);

    case 'locate':
      return require('./locate').locateAndGuide(bot,state,config,args,assertActive);

    case 'explore': {
      return require('./exploration').exploreTerrain(bot, state, config, args, assertActive);
    }

    case 'back':
      return require('./navigation').returnAlongTrail(bot, state, { assertActive });

    case 'route':
      return { message: `矿道：${state._lastMiningPlan ? `${state._lastMiningPlan.label} Y=${state._lastMiningPlan.y} ${state._lastMiningPlan.phase} ${state._lastMiningPlan.mined}/${state._lastMiningPlan.targetCount}` : '暂无'}；返程节点：${(state._lastExpeditionRoute || state._lastNavigationTrail)?.points?.length || 0}；探路标记：${state._explorationMap?.landmarks?.length || 0}。` };

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
      commandPermissions.requireAllowed(bot,state);
      const design = args.design || args.shape || 'house'; // 兼容旧 shape 字段
      const sizeStr = String(args.size || 5);
      const material = args.material || null;
      // Await confirmed construction and preserve the actual game mode.
      state.mode = 'building';
      state.currentTask = `Building: ${design} ${sizeStr}`;
      const { startBuilder } = require('./builder');
      // Forward errors so missing schematics cannot be reported as success.
      const building=startBuilder([design, sizeStr, material,...(args.repair?['--repair']:[])], bot, state)
        .catch((e) => {
          console.error('[AI] build error:', e.message);
          if (state.mode === 'building') state.mode = 'idle';
          state.currentTask = null;
          bot.chat(`盖房子出错啦：${e.message}`);
          throw e;
        });
      bot.chat(`好的，我来盖个 ${design} (大小 ${sizeStr})`);
      return await building;
    }

    case 'cmd': {
      const command = args.command;
      if (typeof command !== 'string' || !command.trim()) {
        throw new Error('需要提供命令参数');
      }
      if (/^\/?(?:minecraft:)?craft(?:\s|$)/i.test(command.trim())) {
        throw new Error('Minecraft 没有 /craft 指令，请使用 craft 合成功能。');
      }
      const modeCommand = command.trim().match(/^\/?(?:minecraft:)?gamemode\s+(\S+)(?:\s+(\S+))?$/i);
      if (modeCommand) {
        if (modeCommand[2] && !['@s', bot.username, config.username].includes(modeCommand[2])) throw new Error('模式工具只修改机器人自己，请明确目标。');
        return runGameModeTask(bot, state, config, normalizeGameMode(modeCommand[1]), assertActive);
      }
      console.log(`[AI Cmd] ${command}`);
      return runCommand(bot,state,command,{assertActive});
    }

    default:
      throw new Error(`不支持的动作：${tool}`);
  }
}

// === Tree helpers ===

// 判断是否为木头类方块
function isWoodBlock(blockName) {
  return require('./lumberjack').isLog(String(blockName || '').replace(/^minecraft:/, ''));
}

function rememberCommand(username, message, tool, success, detail) {
  if (!conversationMemory) return;
  const turn = conversationMemory.begin(username, message);
  conversationMemory.reply(turn, detail || '本地指令已处理');
  conversationMemory.result(turn, tool, success, detail || '本地指令已处理');
  conversationMemory.finish(turn, success ? 'complete' : 'failed');
}
module.exports = { initAI, processMessage, rememberCommand, buildGameContext };
