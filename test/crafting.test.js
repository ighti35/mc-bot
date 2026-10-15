const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('prismarine-registry')('1.21.11');
const injectCraft = require('mineflayer/lib/plugins/craft');
const { craftItem } = require('../modules/crafting');
const { handleChat } = require('../modules/chat');
const { initAI, processMessage } = require('../modules/ai');

// 使用真实 Mineflayer 配方查询与材料检查；只模拟服务器端背包操作。
function fixture(stock = {}, hasTable = false) {
  const amounts = new Map(Object.entries(stock).map(([name, count]) => [registry.itemsByName[name].id, count]));
  const messages = [];
  const calls = [];
  const table = hasTable ? { name: 'crafting_table', position: new Vec3(1, 64, 0) } : null;
  const bot = {
    registry,
    entity: { position: new Vec3(0, 64, 0) }, entities: {}, health: 20, food: 20,
    inventory: {
      count: id => amounts.get(id) || 0,
      items: () => [...amounts].filter(([, count]) => count > 0).map(([id, count]) => ({ ...registry.items[id], count })),
    },
    chat: message => messages.push(message),
    pathfinder: { setGoal() {} }, clearControlStates() {},
    findBlock: () => table,
  };
  injectCraft(bot);
  bot.craft = async (recipe, count, block) => {
    assert.ok(Number.isInteger(count) && count > 0);
    if (recipe.requiresTable) assert.equal(block, table);
    calls.push({ recipe, count, block });
    for (const delta of recipe.delta) {
      const next = (amounts.get(delta.id) || 0) + delta.count * count;
      assert.ok(next >= 0, 'must not consume missing materials');
      amounts.set(delta.id, next);
    }
  };
  return { bot, state: { mode: 'idle', stats: { actionHistory: [] } }, messages, calls, amounts, table };
}

test('2×2 recipe: Chinese name, output rounding, no table window', async () => {
  const f = fixture({ oak_planks: 2 });
  assert.deepEqual(await craftItem('木棍', 1, f.bot, f.state), { item: 'stick', count: 4 });
  assert.equal(f.bot.inventory.count(registry.itemsByName.stick.id), 4);
  assert.equal(f.bot.inventory.count(registry.itemsByName.oak_planks.id), 0);
  assert.equal(f.calls[0].block, null);
  assert.equal(f.state.mode, 'idle');
  assert.equal(f.state._crafting, undefined);
});

test('official batch crafting: output count is converted to recipe executions', async () => {
  const f = fixture({ oak_planks: 4, stick: 20 });
  await craftItem('minecraft:stick', 8, f.bot, f.state);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].count, 2);
  assert.equal(f.bot.inventory.count(registry.itemsByName.stick.id), 28);
});

test('3×3 recipe uses a real nearby crafting table', async () => {
  const f = fixture({ oak_planks: 3, stick: 2 }, true);
  await craftItem('wooden_pickaxe', 1, f.bot, f.state);
  assert.equal(f.calls[0].block, f.table);
  assert.equal(f.bot.inventory.count(registry.itemsByName.wooden_pickaxe.id), 1);
});

test('3×3 recipe without a table gives actionable feedback without consuming items', async () => {
  const f = fixture({ oak_planks: 3, stick: 2 });
  await assert.rejects(craftItem('wooden_pickaxe', 1, f.bot, f.state), /工作台/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.mode, 'idle');
});

test('checks full-quantity materials before starting the official batch', async () => {
  const f = fixture({ oak_log: 1 });
  await assert.rejects(craftItem('oak_planks', 8, f.bot, f.state), /无法合成.*材料/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.mode, 'idle');
});

test('rejects invalid quantities, unknown items and uncraftable items', async () => {
  const f = fixture({ oak_log: 10 });
  for (const count of [0, -1, 1.5, '2oops', Infinity, 2305, null, true]) {
    await assert.rejects(craftItem('oak_planks', count, f.bot, f.state), /数量/);
  }
  await assert.rejects(craftItem('not_an_item', 1, f.bot, f.state), /未知物品/);
  await assert.rejects(craftItem('bedrock', 1, f.bot, f.state), /无法合成.*配方/);
  assert.equal(f.calls.length, 0);
});

test('busy tasks are preserved', async () => {
  const f = fixture({ oak_log: 2 });
  f.state.mode = 'mining';
  f.state.currentTask = 'mine coal';
  await assert.rejects(craftItem('oak_planks', 4, f.bot, f.state), /其他任务/);
  assert.equal(f.state.currentTask, 'mine coal');
  assert.equal(f.state.mode, 'mining');
});

test('server crafting failure is propagated and clears the crafting state', async () => {
  const f = fixture({ oak_log: 2 });
  f.bot.craft = async () => { throw Error('window closed'); };
  await assert.rejects(craftItem('oak_planks', 4, f.bot, f.state), /window closed.*检查背包/);
  assert.equal(f.state.mode, 'idle');
  assert.equal(f.state._crafting, undefined);
  assert.equal(f.messages.length, 0);
});

test('stop explains upstream cancellation limit and duplicate craft cannot overlap', async () => {
  const f = fixture({ oak_log: 3 });
  const original = f.bot.craft;
  let finish;
  f.bot.craft = async (...args) => {
    await new Promise(resolve => { finish = resolve; });
    await original(...args);
  };
  const pending = craftItem('oak_planks', 12, f.bot, f.state);
  await assert.rejects(craftItem('oak_planks', 1, f.bot, f.state), /其他任务/);
  await handleChat('owner', '!stop', f.bot, f.state, { owner: 'owner' });
  await assert.rejects(craftItem('oak_planks', 1, f.bot, f.state), /其他任务/);
  assert.equal(f.state.mode, 'crafting');
  assert.match(f.messages.at(-1), /不支持中途取消/);
  finish();
  assert.deepEqual(await pending, { item: 'oak_planks', count: 12 });
  assert.equal(f.calls.length, 1);
  assert.equal(f.state.mode, 'idle');
});

test('local commands work with AI enabled, enforce ownership and report errors', async (t) => {
  initAI({ aiApiKey: 'test-only', aiApiUrl: 'https://example.invalid', owner: 'owner' });
  t.after(() => initAI({ aiApiKey: '' }));
  t.mock.method(global, 'fetch', () => { throw Error('local commands must not call AI'); });
  const f = fixture({ oak_log: 2 });
  await handleChat('stranger', '!craft oak_planks 4', f.bot, f.state, { owner: 'owner' });
  assert.equal(f.calls.length, 0);
  await handleChat('owner', '!合成 橡木木板 4', f.bot, f.state, { owner: 'owner' });
  assert.equal(f.calls.length, 1);
  await handleChat('owner', '!craft oak_planks 0', f.bot, f.state, { owner: 'owner' });
  assert.match(f.messages.at(-1), /数量/);
});

test('AI craft action reaches the same module and records success', async (t) => {
  const config = { aiApiKey: 'test-only', aiApiUrl: 'https://example.invalid', owner: 'owner' };
  initAI(config);
  t.after(() => initAI({ aiApiKey: '' }));
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.match(JSON.parse(options.body).messages[0].content, /- craft:/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ actions: [{ tool: 'craft', args: { item: 'stick', count: 4 } }] }) } }] }) };
  });
  const f = fixture({ oak_planks: 2 });
  await processMessage('owner', '合成四根木棍', f.bot, f.state, config);
  assert.equal(f.calls.length, 1);
  assert.equal(f.state.stats.actionHistory.at(-1).success, true);
  assert.match(f.messages.at(-1), /合成完成/);
});
