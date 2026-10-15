const test = require('node:test');
const assert = require('node:assert/strict');
const { obtainItem, stopItemGoal } = require('../modules/item-goal');
const { survivalBot } = require('./helpers/survival-bot.cjs');

test('empty inventory to diamond pickaxe: real recipes, harvest prerequisites, placement and smelting', async () => {
  const f = survivalBot();
  const result = await obtainItem('钻石镐', 1, f.bot, f.state);
  assert.equal(result.item, 'diamond_pickaxe');
  assert.equal(f.stock.diamond_pickaxe, 1);
  const crafts = f.events.filter(e => e.type === 'craft').map(e => e.name);
  for (const name of ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'crafting_table', 'furnace']) assert.ok(crafts.includes(name), name);
  assert.ok(crafts.indexOf('wooden_pickaxe') < crafts.indexOf('stone_pickaxe'));
  assert.ok(crafts.indexOf('stone_pickaxe') < crafts.indexOf('iron_pickaxe'));
  assert.ok(f.events.some(e => e.type === 'smelt' && e.name === 'raw_iron'));
  assert.equal(f.state._itemGoal, undefined);
  assert.equal(f.state.mode, 'idle');
});

test('reuses an iron pickaxe and skips the wooden/stone tool chain', async () => {
  const f = survivalBot({ iron_pickaxe: 1, stick: 2 });
  await obtainItem('diamond_pickaxe', 1, f.bot, f.state);
  assert.equal(f.stock.diamond_pickaxe, 1);
  assert.ok(!f.events.some(e => e.type === 'craft' && ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe'].includes(e.name)));
});

test('golden pickaxe is not accepted as an iron pickaxe prerequisite', async () => {
  const f = survivalBot({ golden_pickaxe: 1 });
  await obtainItem('diamond_pickaxe', 1, f.bot, f.state);
  assert.ok(f.events.some(e => e.type === 'craft' && e.name === 'iron_pickaxe'));
  assert.ok(f.events.filter(e => e.type === 'mine' && e.name === 'diamond_ore').every(e => e.tool === 'iron_pickaxe'));
});

test('existing goal output satisfies the requested total without extra crafting', async () => {
  const f = survivalBot({ diamond_pickaxe: 1 });
  const result = await obtainItem('diamond_pickaxe', 1, f.bot, f.state);
  assert.equal(result.steps, 0);
  assert.equal(f.events.length, 0);
});

test('missing resources terminate with a concrete failure, never fake completion', async () => {
  const f = survivalBot({}, []);
  await assert.rejects(obtainItem('diamond_pickaxe', 1, f.bot, f.state), /找不到可达资源/);
  assert.ok(!f.messages.some(m => m.startsWith('目标完成')));
  assert.equal(f.state.lastItemGoal.completed, false);
  assert.equal(f.state._itemGoal, undefined);
  assert.equal(f.state.mode, 'idle');
});

test('stop retains task ownership until the current operation settles', async () => {
  const f = survivalBot({ oak_planks: 2 });
  let release;
  const original = f.bot.craft;
  f.bot.craft = async (...args) => {
    await new Promise(resolve => { release = resolve; });
    await original(...args);
  };
  const pending = obtainItem('stick', 4, f.bot, f.state);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopItemGoal(f.state), true);
  await assert.rejects(obtainItem('stick', 4, f.bot, f.state), /已有任务/);
  release();
  await assert.rejects(pending, /任务已停止/);
  assert.equal(f.state._itemGoal, undefined);
  assert.equal(f.bot.listenerCount('health'), 0);
  assert.ok(!f.messages.some(m => m.startsWith('目标完成')));
});

test('low health aborts before gathering and does not leak state/listeners', async () => {
  const f = survivalBot();
  f.bot.health = 4;
  await assert.rejects(obtainItem('diamond_pickaxe', 1, f.bot, f.state), /生命值过低/);
  assert.equal(f.events.length, 0);
  assert.equal(f.state.mode, 'idle');
  assert.equal(f.bot.listenerCount('death'), 0);
});

test('plain Chinese goal does not execute without an AI API', async (t) => {
  const { handleChat } = require('../modules/chat');
  require('../modules/ai').initAI({});
  t.mock.method(global, 'fetch', () => { throw Error('API is disabled'); });
  const f = survivalBot();
  await handleChat('owner', '合成一把钻石镐', f.bot, f.state, { owner: 'owner' });
  assert.equal(f.events.length, 0);
  assert.match(f.messages.at(-1), /AI 接口/);
});

test('natural goal ownership is checked before consuming any material', async () => {
  const { handleChat } = require('../modules/chat');
  const f = survivalBot();
  await handleChat('stranger', '合成一把钻石镐', f.bot, f.state, { owner: 'owner' });
  assert.equal(f.events.length, 0);
  assert.match(f.messages[0], /only owner/);
});

test('alternative wood and deepslate ore sources complete the same goal', async () => {
  const f = survivalBot({}, ['birch_log', 'stone', 'coal_ore', 'deepslate_iron_ore', 'deepslate_diamond_ore']);
  await obtainItem('diamond_pickaxe', 1, f.bot, f.state);
  assert.equal(f.stock.diamond_pickaxe, 1);
  assert.ok(f.events.some(e => e.name === 'birch_planks'));
  assert.ok(f.events.some(e => e.name === 'deepslate_diamond_ore'));
});

test('collection preserves existing protected blocks and enables movement safety', async () => {
  const f = survivalBot();
  const previous = { dontCreateFlow: false, dontMineUnderFallingBlock: false, blocksCantBreak: new Set([1]) };
  f.bot.pathfinder.movements = previous;
  f.bot.pathfinder.setMovements = value => { f.bot.pathfinder.movements = value; };
  const pluginMovements = f.bot.collectBlock.movements = {};
  const collect = f.bot.collectBlock.collect;
  f.bot.collectBlock.collect = async (...args) => {
    assert.equal(f.bot.collectBlock.movements, null);
    assert.equal(f.bot.pathfinder.movements.dontCreateFlow, true);
    assert.equal(f.bot.pathfinder.movements.dontMineUnderFallingBlock, true);
    assert.ok(f.bot.pathfinder.movements.blocksCantBreak.has(1));
    return collect(...args);
  };
  await obtainItem('diamond_pickaxe', 1, f.bot, f.state);
  assert.equal(f.bot.pathfinder.movements, previous);
  assert.equal(f.bot.collectBlock.movements, pluginMovements);
});

test('completion on the step limit is still success', async () => {
  const f = survivalBot({ oak_planks: 2 });
  const result = await obtainItem('stick', 4, f.bot, f.state, { maxSteps: 1 });
  assert.equal(result.count, 4);
});

test('AI obtain tool executes the goal and records success only after inventory verification', async (t) => {
  const { initAI, processMessage } = require('../modules/ai');
  const config = { owner: 'owner', aiApiKey: 'test-only', aiApiUrl: 'https://example.invalid' };
  initAI(config);
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.match(JSON.parse(options.body).messages[0].content, /- obtain:/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ chat: '开始准备材料', actions: [{ tool: 'obtain', args: { item: 'diamond_pickaxe', count: 1 } }] }) } }] }) };
  });
  const f = survivalBot();
  await processMessage('owner', '给我弄一把钻石镐', f.bot, f.state, config);
  assert.equal(f.stock.diamond_pickaxe, 1);
  assert.equal(f.state.stats.actionHistory.at(-1).success, true);
});
