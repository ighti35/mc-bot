const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pauseWanderingForCommand, stopCurrentTask, waitForAction } = require('./task-control');
const { navigateTo } = require('./navigation');
const { currentGameMode } = require('./game-mode');

const LABELS = {
  dirt: '泥土', cobblestone: '圆石', stone: '石头', deepslate: '深板岩', oak_log: '橡木原木', oak_planks: '橡木木板', acacia_log: '金合欢原木',
  crafting_table: '工作台', furnace: '熔炉', chest: '箱子', torch: '火把', coal: '煤炭', raw_iron: '粗铁', iron_ingot: '铁锭',
  diamond: '钻石', emerald: '绿宝石', gold_ingot: '金锭', redstone: '红石粉', lapis_lazuli: '青金石', bread: '面包', cooked_beef: '牛排',
  wheat_seeds: '小麦种子', string: '线', spider_eye: '蜘蛛眼', prismarine_crystals: '海晶砂粒', stick: '木棍', netherite_ingot: '下界合金锭',
  iron_pickaxe: '铁镐', diamond_pickaxe: '钻石镐', stone_pickaxe: '石镐', wooden_pickaxe: '木镐', netherite_pickaxe: '下界合金镐',
  iron_sword: '铁剑', diamond_sword: '钻石剑', iron_axe: '铁斧', iron_shovel: '铁锹', shield: '盾牌', bow: '弓', bucket: '铁桶', water_bucket: '水桶',
};
const MANAGED_SLOTS = [...Array.from({ length: 40 }, (_, index) => index + 5), 45];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const json = value => JSON.stringify(value, (key, data) => typeof data === 'bigint' ? String(data) : data);

function displayName(bot, item) {
  if (LABELS[item.name]) return LABELS[item.name];
  const alias = Object.entries(global.itemNames || {}).find(([name, id]) => id === item.name && /[\u4e00-\u9fff]/.test(name));
  return alias?.[0] || item.displayName || bot.registry.itemsByName[item.name]?.displayName || item.name;
}

function fingerprint(item) {
  if (!item) return null;
  return crypto.createHash('sha256').update(json({ type: item.type, metadata: item.metadata, count: item.count, nbt: item.nbt, components: item.components })).digest('hex').slice(0, 24);
}

function attachInventoryHooks(bot) {
  bot._inventoryCanGive = false;
  bot._client.on('declare_commands', packet => {
    bot._inventoryCanGive = (packet.nodes || []).some(node => ['give', 'minecraft:give'].includes(node.name || node.extraNodeData?.name));
  });
}

function isConnected(bot) { return Boolean(bot?.inventory && bot.entity && bot._client?.state === 'play'); }
function busyReason(bot, state) {
  if (state?._inventoryTask) return '正在操作物品栏';
  if (state?._gameInventoryTask) return '主人正在游戏内管理背包';
  if (state?._gamemodeTask) return '正在切换游戏模式';
  if (bot?.autoEat?.isEating) return '正在进食';
  if (bot?.currentWindow || bot?.inventory?.selectedItem) return '正在使用合成格或容器';
  if (state?._aiRequest || state?._craftTask || state?._miningTask || state?._explorationTask || state?._navigationTask || (state?.mode && state.mode !== 'idle')) return state.currentTask || '正在执行任务';
  return '';
}

function inventorySnapshot({ bot, state, config }) {
  const connected = isConnected(bot);
  const slots = connected ? MANAGED_SLOTS.map(slot => {
    const item = bot.inventory.slots[slot];
    if (!item) return { slot, item: null };
    let enchants = [];
    try { enchants = (item.enchants || []).map(enchant => ({ name: enchant.name, level: enchant.lvl })); } catch (_) {}
    const maxDurability = bot.registry.itemsByName[item.name]?.maxDurability;
    return { slot, item: {
      name: item.name, label: displayName(bot, item), count: item.count, stackSize: item.stackSize || 64, fingerprint: fingerprint(item),
      enchants, durabilityLeft: maxDurability ? Math.max(0, maxDurability - (item.durabilityUsed || 0)) : null, maxDurability: maxDurability || null,
      customName: typeof item.customName === 'string' ? item.customName : null,
    } };
  }) : [];
  return {
    connected, username: bot?.username || config.username, owner: config.owner,
    mode: state?.mode || 'offline', gameMode: currentGameMode(bot || {}), task: state?.currentTask || null, busy: connected ? busyReason(bot, state) : '机器人离线',
    canAdd: connected && bot._inventoryCanGive === true, health: connected ? bot.health : null, food: connected ? bot.food : null,
    position: connected ? { x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y), z: Math.floor(bot.entity.position.z) } : null,
    ownerVisible: connected && Boolean(bot.players[config.owner]?.entity),
    usedSlots: slots.filter(slot => slot.slot >= 9 && slot.slot <= 44 && slot.item).length,
    slots, updatedAt: Date.now(), serverPort: config.port,
  };
}

function itemCatalog(bot) {
  if (!bot?.registry) return [];
  return bot.registry.itemsArray.map(item => ({ name: item.name, label: displayName(bot, item), stackSize: item.stackSize || 64 }));
}

function availableCapacity(bot, name) {
  const stackSize = bot.registry.itemsByName[name].stackSize || 64;
  return bot.inventory.slots.slice(9, 45).reduce((sum, stack) => {
    if (!stack) return sum + stackSize;
    if (stack.name === name && !stack.nbt && !(stack.components?.length)) return sum + Math.max(0, stackSize - stack.count);
    return sum;
  }, 0);
}

async function performInventoryAction(getContext, body) {
  const { bot, state, config } = getContext();
  if (!isConnected(bot)) throw fail('机器人尚未进入世界。', 409);
  if (body.action === 'stop') { stopCurrentTask(bot, state); return { message: '已发送停止指令，正在结束当前动作。' }; }
  if (!['add', 'take'].includes(body.action)) throw fail('未知物品栏操作。');
  const reason = busyReason(bot, state);
  if (reason) throw fail(`${reason}，请等任务结束，或先停止当前任务。`, 409);
  const count = body.count;
  if (!Number.isSafeInteger(count) || count < 1 || count > 64) throw fail('每次操作数量必须是 1 到 64 的整数。');
  const epoch = state._commandEpoch || 0;
  const releaseCommandAuthorization=body.action==='add'?require('./command-permissions').begin(config.owner,'',bot,state,config):()=>{};
  const token = {};
  const wasEatingEnabled = bot.autoEat?.enabled === true;
  pauseWanderingForCommand(bot, state);
  state._inventoryTask = token;
  state.mode = 'inventory'; state.currentTask = body.action === 'add' ? '面板添加物品' : '面板取出物品';
  if (wasEatingEnabled) bot.autoEat.disableAuto();
  const active = () => {
    if (getContext().bot !== bot || !isConnected(bot)) throw fail('连接已改变，请刷新物品栏。', 409);
    if ((state._commandEpoch || 0) !== epoch) throw fail('操作已停止，请刷新确认背包状态。', 409);
  };
  try {
    active();
    if (body.action === 'add') {
      require('./command-permissions').requireAllowed(bot,state);
      if (bot._inventoryCanGive !== true) throw fail(`添加需要 OP 权限，请在游戏中授权 ${bot.username} 后再试。`, 403);
      const requested = String(body.item || '').replace(/^minecraft:/, '');
      const definition = bot.registry.itemsByName[requested] || itemCatalog(bot).find(item => item.label === requested);
      if (!definition || !/^[a-z0-9_]+$/.test(definition.name)) throw fail('请选择有效的 Minecraft 物品。');
      if (!/^[A-Za-z0-9_]{1,16}$/.test(bot.username)) throw fail('机器人用户名不能用于管理指令。');
      if (availableCapacity(bot, definition.name) < count) throw fail('背包空间不足，先取出一些物品。', 409);
      const total = () => bot.inventory.items().filter(item => item.name === definition.name).reduce((sum, item) => sum + item.count, 0);
      const before = total();
      bot.chat(`/give ${bot.username} minecraft:${definition.name} ${count}`);
      const deadline = Date.now() + 8000;
      while (total() - before < count) {
        active();
        if (Date.now() > deadline) throw fail('服务器尚未确认添加；请刷新检查，避免重复添加，并检查 OP 权限。', 422);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return { message: `已向背包添加 ${count} 个${displayName(bot, definition)}。`, item: definition.name, count };
    }
    const slot = body.slot;
    if (!Number.isInteger(slot) || !MANAGED_SLOTS.includes(slot)) throw fail('请选择有效的背包或装备格。');
    let stack = bot.inventory.slots[slot];
    if (!stack || fingerprint(stack) !== body.fingerprint) throw fail('该格物品已变化，请重新选择。', 409);
    if (stack.count < count) throw fail('取出数量超过该格现有数量。');
    const player = bot.players[config.owner]?.entity;
    if (!player) throw fail('主人不在机器人视野里，请先走近再取出。', 409);
    if (player.position.distanceTo(bot.entity.position) > 2.5) {
      await navigateTo(player.position.x, player.position.y, player.position.z, bot, { state, assertActive: active, timeout: 20000, range: 2 });
    }
    active();
    const currentPlayer = bot.players[config.owner]?.entity;
    if (!currentPlayer || currentPlayer.position.distanceTo(bot.entity.position) > 3) throw fail('你已经走远，请靠近机器人再取出。', 409);
    await waitForAction(bot.lookAt(currentPlayer.position.offset(0, 1, 0)), { assertActive: active, timeout: 5000 });
    active();
    stack = bot.inventory.slots[slot];
    if (!stack || fingerprint(stack) !== body.fingerprint) throw fail('该格物品已变化，取消取出，请重新选择。', 409);
    const before = stack.count;
    // A single source-slot range keeps enchanted/custom stacks intact and avoids taking a different stack of the same type.
    await bot.transfer({ window: bot.inventory, itemType: stack.type, metadata: stack.metadata, count, sourceStart: slot, sourceEnd: slot + 1, destStart: -999, destEnd: -998 });
    const remaining = bot.inventory.slots[slot]?.count || 0;
    if (before - remaining !== count) throw fail('取出数量尚未确认，请刷新查看，不要重复操作。', 422);
    return { message: `已从第 ${slot} 格取出 ${count} 个${displayName(bot, stack)}，在你面前丢出，请拾取。`, slot, count };
  } finally {
    if (state._inventoryTask === token) {
      state._inventoryTask = null;
      if ((state._commandEpoch || 0) === epoch) { state.mode = 'idle'; state.currentTask = null; }
    }
    releaseCommandAuthorization();
    if (wasEatingEnabled && getContext().bot === bot && isConnected(bot)) bot.autoEat.enableAuto();
  }
}

function itemIcon(name) {
  let art;
  if (/pickaxe|axe|shovel|hoe|sword/.test(name)) {
    const color = name.startsWith('diamond') ? '#60d6d3' : name.startsWith('netherite') ? '#655e73' : name.startsWith('golden') ? '#efc851' : name.startsWith('wooden') ? '#ad7f45' : '#becbd2';
    art = `<path d="M9 9h12v3h3v6h-3v-3h-3v-3H9z" fill="${color}"/><path d="m17 13-3 3-3 3-3 3-3 3 3 3 3-3 3-3 3-3 3-3z" fill="#9c743e"/>`;
  } else if (/diamond|emerald|crystal|lapis|redstone/.test(name)) {
    const color = /emerald/.test(name) ? '#65d68a' : /redstone/.test(name) ? '#df7270' : /lapis/.test(name) ? '#7290d8' : '#6ed0d4';
    art = `<path d="M10 7h12l6 8-12 14L4 15z" fill="${color}"/><path d="m10 7 6 8 6-8M4 15h24M16 15v14" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="2"/>`;
  } else if (/seed|wheat|sapling|flower/.test(name)) {
    art = '<path d="M15 9h3v20h-3zM8 6h6v6H8zM19 11h6v6h-6zM8 17h6v6H8z" fill="#86b46e"/>';
  } else if (name === 'torch') {
    art = '<path d="M14 11h5v18h-5z" fill="#b88951"/><path d="M11 4h11v11H11z" fill="#ebac54"/><path d="M14 2h5v9h-5z" fill="#ffe19b"/>';
  } else {
    const color = /dirt|log|planks|table|bread|stick/.test(name) ? '#b18a60' : /gold/.test(name) ? '#dcb854' : /iron|stone|bucket/.test(name) ? '#97a9aa' : '#a5b4b8';
    art = `<path d="m16 3 13 7v14l-13 7L3 24V10z" fill="${color}"/><path d="m3 10 13 7 13-7M16 17v14" fill="none" stroke="#182839" stroke-opacity=".3" stroke-width="2"/><path d="m16 3 13 7-13 7-13-7z" fill="#fff" fill-opacity=".14"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">${art}</svg>`;
}

function startInventoryPanel(getContext, options = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const directory = path.join(__dirname, '..', 'public', 'inventory');
  const server = http.createServer(async (request, response) => {
    const port = server.address()?.port;
    const host = request.headers.host;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) { response.writeHead(403); response.end('Local access only'); return; }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const reply = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(json(data)); };
    try {
      const url = new URL(request.url, `http://${host}`);
      if(url.pathname.startsWith('/api/build/')){
        const build=require('./build-panel');
        if(request.method==='GET'&&url.pathname==='/api/build/catalog'){reply(200,{items:await build.catalog()});return;}
        if(request.method==='GET'&&url.pathname==='/api/build/entry'){
          const size=Number(url.searchParams.get('size')||5);if(!Number.isInteger(size)||size<3||size>64)throw fail('基础房型尺寸应为 3 到 64');reply(200,await build.entry(url.searchParams.get('id'),size));return;
        }
        if(request.method==='GET'&&url.pathname==='/api/build/status'){reply(200,build.snapshot(getContext()));return;}
        if(request.method==='GET'&&url.pathname==='/api/build/session'){
          if(request.headers['x-bot-game-client']!=='building-menu'||request.headers.origin||request.headers['sec-fetch-site']||request.headers['x-bot-viewer']!==getContext().config.owner)throw fail('仅主人游戏客户端可连接建筑菜单',403);
          reply(200,{token,owner:getContext().config.owner});return;
        }
        if(request.method==='POST'&&url.pathname==='/api/build/action'){
          if(request.headers['x-panel-token']!==token||request.headers['x-bot-game-client']!=='building-menu'||request.headers.origin||request.headers['sec-fetch-site'])throw fail('建筑菜单连接已失效，请重新打开',403);
          if(!String(request.headers['content-type']).startsWith('application/json'))throw fail('请求必须是 JSON',415);
          let raw='';for await(const chunk of request){raw+=chunk.toString('utf8');if(Buffer.byteLength(raw)>4096)throw fail('请求过大',413);}
          let body;try{body=JSON.parse(raw);}catch{throw fail('无效 JSON 请求');}
          reply(202,await build.action(getContext,body));return;
        }
      }
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(fs.readFileSync(path.join(directory, 'index.html'), 'utf8').replace('{{PANEL_TOKEN}}', token)); return;
      }
      if (request.method === 'GET' && ['/app.js', '/style.css'].includes(url.pathname)) {
        response.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' });
        response.end(fs.readFileSync(path.join(directory, url.pathname.slice(1)))); return;
      }
      const icon = url.pathname.match(/^\/icons\/([a-z0-9_]+)\.svg$/);
      if (request.method === 'GET' && icon) { response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' }); response.end(itemIcon(icon[1])); return; }
      if (request.method === 'GET' && url.pathname === '/api/state') { reply(200, inventorySnapshot(getContext())); return; }
      if (request.method === 'GET' && url.pathname === '/api/items') { reply(200, { items: itemCatalog(getContext().bot) }); return; }
      if (request.method === 'POST' && url.pathname === '/api/action') {
        const provided = request.headers['x-panel-token'];
        if (typeof provided !== 'string' || Buffer.byteLength(provided) !== Buffer.byteLength(token) || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(token))) throw fail('请从本机面板发起操作。', 403);
        if (request.headers.origin !== `http://${host}` || request.headers['sec-fetch-site'] === 'cross-site') throw fail('不接受其他网页的操作请求。', 403);
        if (!String(request.headers['content-type']).startsWith('application/json')) throw fail('请求必须是 JSON。', 415);
        let raw = ''; let length = 0;
        for await (const chunk of request) { length += chunk.length; if (length > 4096) throw fail('请求过大。', 413); raw += chunk.toString('utf8'); }
        let body;
        try { body = JSON.parse(raw); } catch (_) { throw fail('无效请求。'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('无效请求。');
        reply(200, await performInventoryAction(getContext, body)); return;
      }
      reply(404, { error: '不存在的接口' });
    } catch (error) {
      console.error('[Inventory Panel]', error.message);
      if (!response.headersSent) reply(error.status || 500, { error: error.message });
      else response.end();
    }
  });
  let fallback = false;
  server.on('error', error => {
    if (error.code === 'EADDRINUSE' && !fallback) { fallback = true; server.listen(0, '127.0.0.1'); }
    else console.error('[Inventory Panel] 启动失败:', error.message);
  });
  server.on('listening', () => console.log(`[Inventory Panel] http://127.0.0.1:${server.address().port}`));
  server.listen(options.port ?? 52592, '127.0.0.1');
  return server;
}

module.exports = { startInventoryPanel, attachInventoryHooks, inventorySnapshot, itemCatalog, performInventoryAction, fingerprint, itemIcon };
