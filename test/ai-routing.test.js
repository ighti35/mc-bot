const test = require('node:test');
const assert = require('node:assert/strict');
const { initAI } = require('../modules/ai');
const { handleChat } = require('../modules/chat');
const { survivalBot } = require('./helpers/survival-bot.cjs');
const config = { aiApiKey: 'test-only', aiApiUrl: 'https://example.invalid/v1/chat/completions', aiModel: 'test-model', owner: 'owner' };

function mockAPI(t, reply, inspect = () => {}) {
  initAI(config);
  t.after(() => initAI({}));
  let calls = 0;
  t.mock.method(global, 'fetch', async (url, options) => {
    calls++;
    assert.equal(url, config.aiApiUrl);
    const body = JSON.parse(options.body);
    assert.equal(body.model, config.aiModel);
    inspect(body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: typeof reply === 'string' ? reply : JSON.stringify(reply) } }] }) };
  });
  return () => calls;
}

test('all ordinary phrasing reaches API unchanged; model chat never triggers keyword actions', async t => {
  let current;
  const calls = mockAPI(t, '这是解释，不执行操作。', body => {
    assert.ok(body.messages.at(-1).content.startsWith(`[Player owner] ${current}\n`));
    assert.match(body.messages[0].content, /no fixed phrases/);
  });
  const f = survivalBot();
  for (current of ['给钻石镐附魔效率五', '合成一把钻石镐', '先别动那本书，我想了解费用', 'come here', '停止附魔']) {
    await handleChat('owner', current, f.bot, f.state, config);
  }
  assert.equal(calls(), 5);
  assert.equal(f.events.length, 0);
  assert.equal(f.state.mode, 'idle');
});

test('model-selected obtain action executes for unrestricted phrasing', async t => {
  mockAPI(t, { actions: [{ tool: 'obtain', args: { item: 'oak_planks', count: 4 } }] });
  const f = survivalBot({ oak_log: 1 });
  await handleChat('owner', '刚才说的材料就先备四块吧', f.bot, f.state, config);
  assert.equal(f.stock.oak_planks, 4);
  assert.equal(f.state.stats.actionHistory.at(-1).action, 'obtain');
});

test('busy task still sends questions and cancellation to AI', async t => {
  let reply = { chat: '正在处理附魔。', actions: [] };
  initAI(config);
  t.after(() => initAI({}));
  let calls = 0;
  t.mock.method(global, 'fetch', async () => {
    calls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }] }) };
  });
  const f = survivalBot();
  f.state.mode = 'enchanting';
  f.state._enchanting = { cancelled: false };
  await handleChat('owner', '忙到哪一步了', f.bot, f.state, config);
  assert.equal(f.state._enchanting.cancelled, false);
  reply = { actions: [{ tool: 'stop', args: {} }] };
  await handleChat('owner', '这个先放一放，暂时别做了', f.bot, f.state, config);
  assert.equal(f.state._enchanting.cancelled, true);
  assert.equal(calls, 2);
});

test('missing or failed API never falls back to local intent guessing', async t => {
  const f = survivalBot();
  initAI({});
  let calls = 0;
  t.mock.method(global, 'fetch', async () => { calls++; throw new Error('offline'); });
  await handleChat('owner', '合成一把钻石镐', f.bot, f.state, config);
  assert.equal(calls, 0);
  initAI(config);
  t.after(() => initAI({}));
  await handleChat('owner', 'come here', f.bot, f.state, config);
  await handleChat('owner', '给钻石镐附魔效率五', f.bot, f.state, config);
  assert.equal(calls, 2);
  assert.equal(f.events.length, 0);
  assert.ok(f.messages.every(s => s.includes('AI 接口')));
});

test('explicit commands remain manual and unauthorized requests never reach the API', async t => {
  const calls = mockAPI(t, '不应调用');
  const f = survivalBot({ oak_log: 1 });
  await handleChat('stranger', '合成一把钻石镐', f.bot, f.state, config);
  await handleChat('owner', '!craft oak_planks 4', f.bot, f.state, config);
  assert.equal(calls(), 0);
  assert.equal(f.stock.oak_planks, 4);
});
