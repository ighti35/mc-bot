const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('prismarine-registry')('1.21.11');
const { enchantItem, enchants, findBestItem, improvements } = require('../modules/anvil');

function item(name, slot, enchantments = []) {
  const key = name === 'enchanted_book' ? 'stored_enchantments' : 'enchantments';
  return { name, type: registry.itemsByName[name].id, count: 1, slot,
    componentMap: new Map([[key, { data: { enchantments: enchantments.map(([name, level]) => ({ id: registry.enchantmentsByName[name].id, level })) } }]]) };
}
function fixture({ cost = 5, level = 20, result = [['sharpness', 3]], failTake = false, delay = 0 } = {}) {
  const bot = new EventEmitter();
  const equipment = item('diamond_sword', 9);
  const wrong = item('enchanted_book', 10, [['efficiency', 4]]);
  const book = item('enchanted_book', 11, [['sharpness', 3]]);
  let inventory = [equipment, wrong, book];
  const messages = [], moves = [];
  const window = { id: 2, inventoryStart: 3, slots: Array(39).fill(null),
    close() { inventory.push(...window.slots.slice(0, 2).filter(Boolean)); window.slots.fill(null); bot.currentWindow = null; } };
  Object.assign(bot, { registry, _client: new EventEmitter(), entity: { position: new Vec3(0, 0, 0) },
    game: { gameMode: 'survival' }, experience: { level }, inventory: { items: () => inventory },
    chat: message => messages.push(message), pathfinder: { setGoal() {} },
    findBlock: () => ({ name: 'anvil', position: new Vec3(1, 0, 0) }),
    async openAnvil() { bot.currentWindow = window; return window; },
    async moveSlotItem(source, dest) {
      moves.push([source, dest]);
      const selected = inventory.find(i => i.slot === source - window.inventoryStart + 9);
      assert.ok(selected);
      window.slots[dest] = selected;
      inventory = inventory.filter(i => i !== selected);
      if (dest === 1) {
        setTimeout(() => {
          window.slots[2] = item('diamond_sword', 9, result);
          bot._client.emit('craft_progress_bar', { windowId: 2, property: 0, value: cost });
        }, delay);
      }
    },
    async putAway(slot) {
      assert.equal(slot, 2);
      if (failTake) throw new Error('server rejected click');
      await new Promise(r => setTimeout(r, 5));
      inventory.push(window.slots[2]);
      window.slots.fill(null);
      bot.experience.level -= cost;
    },
  });
  return { bot, state: { mode: 'idle' }, messages, moves, equipment, book, window };
}

test('reads modern stored enchantments and legacy normalized enchants', () => {
  assert.deepEqual(enchants(item('enchanted_book', 9, [['mending', 1]]), registry), [{ name: 'mending', lvl: 1 }]);
  assert.deepEqual(enchants({ enchants: [{ name: 'minecraft:efficiency', lvl: 4 }] }, registry), [{ name: 'efficiency', lvl: 4 }]);
});
test('exact tool categories do not confuse axe/pickaxe or bow/crossbow', () => {
  const bot = { inventory: { items: () => [item('diamond_pickaxe', 9), item('iron_axe', 10), item('crossbow', 11), item('bow', 12)] } };
  assert.equal(findBestItem(bot, 'axe').name, 'iron_axe');
  assert.equal(findBestItem(bot, 'bow').name, 'bow');
});
test('rejects conflicting, incompatible and maximum-level books', () => {
  const bot = { registry };
  assert.equal(improvements(bot, item('diamond_pickaxe', 9, [['silk_touch', 1]]), item('enchanted_book', 10, [['fortune', 3]])).length, 0);
  assert.equal(improvements(bot, item('diamond_pickaxe', 9), item('enchanted_book', 10, [['sharpness', 3]])).length, 0);
  assert.equal(improvements(bot, item('diamond_sword', 9, [['sharpness', 5]]), item('enchanted_book', 10, [['sharpness', 5]])).length, 0);
});
test('selects the exact book slot, awaits server preview and inventory result', async () => {
  const f = fixture({ delay: 30 });
  const result = await enchantItem(f.bot, '钻石剑', '锋利 3', f.state);
  assert.equal(result.cost, 5);
  assert.deepEqual(f.moves, [[3, 0], [5, 1]]);
  assert.ok(f.bot.inventory.items().some(i => i.slot === 10));
  assert.ok(f.messages.some(s => s.startsWith('附魔完成')));
  assert.equal(f.state.mode, 'idle');
  assert.equal(f.bot._client.listenerCount('craft_progress_bar'), 0);
});
for (const [name, options, error] of [
  ['insufficient XP', { level: 2 }, /经验不足/],
  ['too expensive', { cost: 40 }, /费用过高/],
  ['wrong server result', { result: [['unbreaking', 3]] }, /预期附魔/],
  ['failed withdrawal', { failTake: true }, /server rejected/],
]) {
  test(name + ' does not announce success and returns inputs on close', async () => {
    const f = fixture(options);
    await assert.rejects(enchantItem(f.bot, 'diamond_sword', 'sharpness', f.state), error);
    assert.ok(!f.messages.some(s => s.startsWith('附魔完成')));
    assert.ok(f.bot.inventory.items().includes(f.book));
    assert.equal(f.state.mode, 'idle');
    assert.equal(f.bot.currentWindow, null);
  });
}
test('stop during navigation prevents opening or consuming the book', async () => {
  const f = fixture();
  f.bot.entity.position = new Vec3(100, 0, 0);
  const pending = enchantItem(f.bot, 'diamond_sword', 'sharpness', f.state);
  f.state._enchanting.cancelled = true;
  await assert.rejects(pending, /已停止/);
  assert.equal(f.moves.length, 0);
  assert.equal(f.state.mode, 'idle');
});
test('missing server response times out and releases listeners and window', async () => {
  const f = fixture({ cost: 0 });
  await assert.rejects(enchantItem(f.bot, 'diamond_sword', 'sharpness', f.state, { timeoutMs: 50 }), /超时/);
  assert.equal(f.bot._client.listenerCount('craft_progress_bar'), 0);
  assert.equal(f.bot.currentWindow, null);
});
test('rejects unknown enchant, missing books, concurrent tasks before opening', async () => {
  const f = fixture();
  await assert.rejects(enchantItem(f.bot, 'diamond_sword', 'nonsense', f.state), /未知附魔/);
  await assert.rejects(enchantItem(f.bot, 'diamond_sword', '锋利 5', f.state), /没有可提升/);
  f.state.mode = 'mining';
  await assert.rejects(enchantItem(f.bot, 'diamond_sword', 'sharpness', f.state), /停止当前任务/);
  assert.equal(f.moves.length, 0);
});
test('equal-level book upgrades to requested next level', async () => {
  const f = fixture({ result: [['sharpness', 4]] });
  f.equipment.componentMap = item('diamond_sword', 9, [['sharpness', 3]]).componentMap;
  const result = await enchantItem(f.bot, 'diamond_sword', 'sharpness 4', f.state);
  assert.deepEqual(result.enchants, [{ name: 'sharpness', lvl: 4 }]);
});
test('Chinese command bypasses AI, awaits completion and enforces owner', async () => {
  const { handleChat } = require('../modules/chat');
  const f = fixture();
  await handleChat('stranger', '!附魔 钻石剑 锋利 3', f.bot, f.state, { owner: 'owner' });
  assert.equal(f.moves.length, 0);
  await handleChat('owner', '!附魔 钻石剑 锋利 3', f.bot, f.state, { owner: 'owner' });
  assert.ok(f.messages.some(s => s.startsWith('附魔完成')));
  assert.equal(f.state.mode, 'idle');
});
test('chat stop cancels an active enchant without prematurely releasing its lock', async () => {
  const { handleChat } = require('../modules/chat');
  const f = fixture();
  f.bot.entity.position = new Vec3(100, 0, 0);
  const pending = enchantItem(f.bot, 'diamond_sword', 'sharpness', f.state);
  await handleChat('owner', '!stop', f.bot, f.state, { owner: 'owner' });
  assert.ok(f.state._enchanting);
  await assert.rejects(pending, /已停止/);
  assert.equal(f.state.mode, 'idle');
});
test('API interprets arbitrary phrasing and invokes the same awaited enchant executor', async t => {
  const { initAI } = require('../modules/ai');
  const { handleChat } = require('../modules/chat');
  const config = { aiApiKey: 'test-only', aiApiUrl: 'https://example.invalid', owner: 'owner' };
  initAI(config);
  t.after(() => initAI({}));
  const f = fixture();
  f.bot.entities = {};
  f.bot.heldItem = f.equipment;
  f.state.stats = {};
  t.mock.method(global, 'fetch', async (url, options) => {
    const input = JSON.parse(options.body).messages.at(-1).content;
    assert.match(input, /手上这把打怪不太够力，用背包那本书加强一下/);
    assert.match(input, /HeldItem:diamond_sword XP:20/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ actions: [{ tool: 'enchant', args: { item: 'diamond_sword', enchant: 'sharpness', level: 3 } }] }) } }] }) };
  });
  await handleChat('owner', '手上这把打怪不太够力，用背包那本书加强一下', f.bot, f.state, config);
  assert.ok(f.messages.some(s => s.startsWith('附魔完成')));
  assert.equal(f.state.stats.actionHistory.at(-1).success, true);
});
