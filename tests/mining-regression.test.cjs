const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const project = require('node:path').resolve(__dirname, '..');
const req = createRequire(project + '/package.json');
const { Vec3 } = req('vec3');
const { startMiner } = req('./modules/miner');
const { dropItem } = req('./modules/item-transfer');
const { stopCurrentTask } = req('./modules/task-control');
const turn = () => new Promise(resolve => setImmediate(resolve));

function fixture(initial = 0, totalBlocks = 15) {
  let dirt = initial;
  const blocks = Array.from({ length: totalBlocks }, (_, index) => ({ name: 'dirt', position: new Vec3(index + 1, 0, 0) }));
  const state = { mode: 'idle', _wanderEnabled: true, stats: { blocksMined: 0, itemsCollected: 0 } };
  const tossed = [];
  const chats = [];
  const bot = {
    registry: { blocksByName: { dirt: { id: 9 } } },
    health: 20, food: 20,
    entity: { position: new Vec3(0, 1, 0) }, entities: {},
    players: { Owner: { entity: { position: new Vec3(0, 1, 2) } } },
    pathfinder: { movements: {}, setGoal() {}, goto: async () => {} },
    clearControlStates() {}, stopDigging() {}, lookAt: async () => {},
    inventory: { items: () => dirt ? [{ name: 'dirt', type: 9, metadata: 0, count: dirt }] : [] },
    chat: message => chats.push(message),
    findBlocks(options) {
      // Real mineflayer scans the chunk palette with position=null before visiting actual blocks.
      assert.equal(options.matching({ name: 'dirt', position: null }), true);
      return blocks.filter(block => block.name === 'dirt' && options.matching(block) && options.useExtraInfo(block)).slice(0, options.count).map(block => block.position);
    },
    blockAt: position => blocks.find(block => block.position.equals(position)) || { name: 'air', position },
    toss: async (id, metadata, count) => { assert.equal(id, 9); tossed.push(count); dirt -= count; },
  };
  bot.collectBlock = {
    cancelTask: async () => {},
    collect: async block => { await turn(); block.name = 'air'; dirt++; },
  };
  return { bot, state, tossed, chats, blocks, dirt: () => dirt };
}

test('palette blocks without coordinates do not crash; mining stops at exactly ten collected blocks', async () => {
  const f = fixture();
  const result = await startMiner('dirt', f.bot, f.state, {}, 10);
  assert.equal(result.mined, 10);
  assert.equal(result.collected, 10);
  assert.equal(f.dirt(), 10);
  assert.equal(f.blocks.filter(block => block.name === 'air').length, 10);
  assert.equal(f.state.stats.blocksMined, 10);
  assert.equal(f.state.mode, 'idle');
  assert.equal(f.state._wanderEnabled, false);
});

test('failed collection is not counted as successful mining', async () => {
  const f = fixture();
  f.bot.collectBlock.collect = async () => { throw new Error('NoPath'); };
  await assert.rejects(startMiner('dirt', f.bot, f.state, {}, 10), /5.*无法/);
  assert.equal(f.state.stats.blocksMined, 0);
  assert.equal(f.dirt(), 0);
  assert.equal(f.state.mode, 'idle');
});

test('drop ten from fourteen leaves four and awaits inventory transfer', async () => {
  const f = fixture(14);
  const result = await dropItem(f.bot, f.state, { owner: 'Owner' }, { item: 'dirt', count: 10 });
  assert.equal(result.count, 10);
  assert.deepEqual(f.tossed, [10]);
  assert.equal(f.dirt(), 4);
});

test('stop interrupts an in-flight collection and never records the block as mined', async () => {
  const f = fixture();
  let entered;
  const collecting = new Promise(resolve => { entered = resolve; });
  f.bot.collectBlock.collect = () => { entered(); return new Promise(() => {}); };
  const pending = startMiner('dirt', f.bot, f.state, {}, 10);
  await collecting;
  stopCurrentTask(f.bot, f.state);
  await assert.rejects(pending, error => error.code === 'TASK_CANCELLED');
  assert.equal(f.state.stats.blocksMined, 0);
  assert.equal(f.state.mode, 'idle');
});

test('AI mine-then-drop waits for all ten blocks before giving any away', async () => {
  const f = fixture();
  const ai = req('./modules/ai');
  const oldFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ chat: '开始执行', actions: [
    { tool: 'mine', args: { block: 'dirt', count: 10 } },
    { tool: 'drop', args: { item: 'dirt', count: 10 } },
  ] }) } }] }) });
  ai.initAI({ aiApiKey: 'mock-key' });
  try {
    const pending = ai.processMessage('Owner', '挖十个泥土丢给我', f.bot, f.state, { owner: 'Owner' });
    await turn();
    assert.deepEqual(f.tossed, []);
    await pending;
    assert.deepEqual(f.tossed, [10]);
    assert.equal(f.dirt(), 0);
    assert.deepEqual(f.state.stats.actionHistory.map(action => [action.action, action.success]), [['mine', true], ['drop', true]]);
  } finally { global.fetch = oldFetch; }
});

