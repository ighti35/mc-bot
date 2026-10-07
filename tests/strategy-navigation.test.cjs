const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const req = createRequire(require('node:path').join(__dirname, '..', 'package.json'));
const registry = req('minecraft-data')('1.21.11');
const { Vec3 } = req('vec3');
const Block = req('prismarine-block')(registry);
const { Movements } = req('mineflayer-pathfinder');
const plan = req('./modules/mining-plan');
const terrain = req('./modules/terrain');
const navigation = req('./modules/navigation');
const exploration = req('./modules/exploration');
const { runBranchMining } = req('./modules/branch-miner');
const { planTargetTunnel, scanTargets } = req('./modules/target-mining');
const { stopCurrentTask } = req('./modules/task-control');
const turn = () => new Promise(resolve => setImmediate(resolve));

function worldFixture({ solid = false, startY = 1, lavaFloor = false } = {}) {
  const cells = new Map();
  const inventory = new Map([['iron_pickaxe', 1]]);
  const travel = [];
  const digs = [];
  const chats = [];
  const key = point => `${Math.floor(point.x)},${Math.floor(point.y)},${Math.floor(point.z)}`;
  const set = (point, name) => cells.set(key(point), name);
  const bot = {
    registry, game: { dimension: 'overworld', minY: -64, height: 384 },
    health: 20, food: 20, entity: { position: new Vec3(0.5, startY, 0.5), effects: {} }, entities: {}, players: {},
    clearControlStates() {}, stopDigging() {}, chat: message => chats.push(message),
    blockAt(point) {
      if (!point) return null;
      const name = cells.get(key(point)) || (solid ? 'stone' : point.y < 1 ? (lavaFloor ? 'lava' : 'stone') : 'air');
      const block = Block.fromStateId(registry.blocksByName[name].minStateId, 0);
      block.position = point.floored(); block.light = 15; block.biome = registry.biomesByName.plains.id;
      return block;
    },
    inventory: {
      items: () => [...inventory].filter(([, count]) => count > 0).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, metadata: 0, durabilityUsed: 0 })),
      emptySlotCount: () => 35,
    },
    equip: async item => { bot.heldItem = item; },
    dig: async block => {
      await turn(); digs.push({ name: block.name, point: block.position }); set(block.position, 'air');
      const name = block.name.includes('iron_ore') ? 'raw_iron' : block.name.includes('diamond_ore') ? 'diamond' : 'cobblestone';
      inventory.set(name, (inventory.get(name) || 0) + 1);
    },
    findBlocks(options) {
      const palette = [...new Set(cells.values())];
      // Palette entries have no coordinates in the real findBlocks API.
      for (const name of palette) options.matching({ name, position: null });
      return [...cells].map(([location]) => bot.blockAt(new Vec3(...location.split(',').map(Number))))
        .filter(block => options.matching(block) && (!options.useExtraInfo || options.useExtraInfo(block)) && block.position.distanceTo(bot.entity.position) <= options.maxDistance)
        .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
        .slice(0, options.count).map(block => block.position);
    },
  };
  set(new Vec3(0, startY, 0), 'air'); set(new Vec3(0, startY + 1, 0), 'air');
  bot.pathfinder = {
    setGoal() {}, setMovements: movements => { bot.pathfinder.movements = movements; },
    goto: async goal => { await turn(); travel.push(new Vec3(goal.x, goal.y, goal.z)); bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); },
  };
  bot.pathfinder.movements = new Movements(bot);
  bot.pathfinder.movements.blocksCantBreak.add(registry.blocksByName.crafting_table.id);
  bot.tool = { equipForBlock: async () => { bot.heldItem = bot.inventory.items().find(item => item.name === 'iron_pickaxe'); } };
  bot.collectBlock = {
    movements: bot.pathfinder.movements, cancelTask: async () => {},
    collect: async block => {
      await turn();
      if (Array.isArray(block)) return;
      const name = block.name.includes('iron_ore') ? 'raw_iron' : 'diamond';
      set(block.position, 'air'); inventory.set(name, (inventory.get(name) || 0) + 1);
    },
  };
  const state = { mode: 'idle', _wanderEnabled: true, stats: { blocksMined: 0, itemsCollected: 0 } };
  return { bot, state, cells, inventory, travel, digs, chats, set, key };
}

test('ore profiles merge ordinary/deepslate variants and select per-ore heights', () => {
  assert.equal(plan.oreProfile('deepslate_diamond_ore').key, 'diamond');
  assert.equal(plan.oreProfile('lapis_lazuli').key, 'lapis');
  const f = worldFixture();
  assert.equal(plan.buildMiningPlan(f.bot, '钻石').y, -58);
  assert.equal(plan.buildMiningPlan(f.bot, 'iron').y, 16);
  assert.equal(plan.buildMiningPlan(f.bot, 'copper').y, 48);
  assert.equal(plan.buildMiningPlan(f.bot, 'gold').y, -16);
  assert.equal(plan.buildMiningPlan(f.bot, 'lapis').y, 0);
});

test('mine height overrides include Y=0 and reject world-edge/incorrect-dimension plans', () => {
  const f = worldFixture();
  assert.equal(plan.buildMiningPlan(f.bot, 'iron', { y: 0 }).y, 0);
  assert.throws(() => plan.buildMiningPlan(f.bot, 'diamond', { y: -64 }), /高度/);
  assert.throws(() => plan.buildMiningPlan(f.bot, 'ancient_debris'), /维度/);
  assert.throws(() => plan.buildMiningPlan(f.bot, 'emerald'), /山地/);
});

test('coal plans choose a reachable underground height instead of building an aerial tunnel', () => {
  const f = worldFixture({ startY: 70 });
  assert.equal(plan.buildMiningPlan(f.bot, 'coal').y, 62);
  assert.equal(plan.buildMiningPlan(f.bot, 'coal', { y: 96 }).y, 96);
});

test('stairs always advance horizontally and change height by at most one; branches cover both sides', () => {
  const next = plan.nextStairPoint({ x: 0, y: 70, z: 0 }, -58, plan.DIRECTIONS.east);
  assert.deepEqual(next, { x: 1, y: 69, z: 0 });
  assert.deepEqual(plan.branchEndpoints({ x: 4, y: -58, z: 0 }, plan.DIRECTIONS.east, 12), [
    { x: 4, y: -58, z: -12 }, { x: 4, y: -58, z: 12 },
  ]);
});

test('stair clearance includes the extra overhead block needed to descend and climb back', () => {
  const f = worldFixture({ solid: true, startY: 2 });
  const result = terrain.inspectTunnelStep(f.bot, new Vec3(0, 2, 0), new Vec3(1, 1, 0));
  assert.equal(result.safe, true);
  assert.deepEqual(result.blocks.map(block => block.position.y), [3, 2, 1]);
});

test('tunnel inspection rejects lava, unsupported drops, buildings and falling ceilings before digging', () => {
  const f = worldFixture({ solid: true, startY: 0 });
  const from = new Vec3(0, 0, 0), to = new Vec3(1, 0, 0);
  f.set(new Vec3(2, 1, 0), 'lava');
  assert.equal(terrain.inspectTunnelStep(f.bot, from, to).safe, false);
  f.set(new Vec3(2, 1, 0), 'stone'); f.set(new Vec3(1, -1, 0), 'air');
  assert.equal(terrain.inspectTunnelStep(f.bot, from, to).safe, false);
  f.set(new Vec3(1, -1, 0), 'stone'); f.set(new Vec3(1, 1, 0), 'crafting_table');
  assert.equal(terrain.inspectTunnelStep(f.bot, from, to).safe, false);
  f.set(new Vec3(1, 1, 0), 'stone'); f.set(new Vec3(1, 2, 0), 'gravel');
  assert.equal(terrain.inspectTunnelStep(f.bot, from, to).safe, false);
  assert.equal(f.digs.length, 0);
});

test('walking policy avoids liquids/building damage, disables parkour/towering and preserves protected blocks', () => {
  const f = worldFixture();
  const movements = navigation.safeMovements(f.bot);
  assert.equal(movements.canDig, false);
  assert.equal(movements.maxDropDown, 2);
  assert.equal(movements.allowParkour, false);
  assert.equal(movements.allow1by1towers, false);
  assert(movements.blocksToAvoid.has(registry.blocksByName.lava.id));
  assert(movements.blocksToAvoid.has(registry.blocksByName.water.id));
  assert(movements.blocksCantBreak.has(registry.blocksByName.crafting_table.id));
});

test('real pathfinder permits the reported one-level descent but rejects a two-level drop', () => {
  const f = worldFixture({ solid: true, startY: 70 });
  const Move = req('mineflayer-pathfinder/lib/move');
  f.bot.entity.position = new Vec3(6.5, 70, 21.5);
  for (const point of [new Vec3(6,70,21), new Vec3(6,71,21), new Vec3(7,69,21), new Vec3(7,70,21), new Vec3(7,71,21)]) f.set(point, 'air');
  const movements = navigation.safeMovements(f.bot);
  const neighbors = () => movements.getNeighbors(new Move(6,70,21,0,0));
  assert(neighbors().some(point => point.x === 7 && point.y === 69 && point.z === 21));
  f.set(new Vec3(7,68,21), 'air');
  assert(!neighbors().some(point => point.x === 7 && point.y === 68 && point.z === 21));
});

test('exact arrival accepts all positions inside the same foot cell, including negative-coordinate edges', async () => {
  const f = worldFixture();
  f.bot.entity.position = new Vec3(-17.05, 72, 6.95);
  const result = await navigation.navigateTo(-18, 72, 6, f.bot, { state: f.state, range: 0, exact: true });
  assert.equal(result.arrived, true);
  assert.equal(f.travel.length, 0);
  assert.equal(navigation.hasArrived(new Vec3(-16.99, 72, 6.95), new Vec3(-18,72,6), 0), false);
  assert.equal(navigation.hasArrived(new Vec3(-17.05, 71, 6.95), new Vec3(-18,72,6), 0), false);
});

test('pathfinder arrival near a target cell edge is valid without accepting another cell', async () => {
  const f = worldFixture();
  f.bot.pathfinder.goto = async goal => { await turn(); f.bot.entity.position = new Vec3(goal.x + 0.95, goal.y, goal.z + 0.95); };
  const result = await navigation.navigateTo(5, 1, 0, f.bot, { state: f.state, range: 0, exact: true });
  assert.equal(result.arrived, true);
  assert(f.bot.entity.position.floored().equals(new Vec3(5,1,0)));
});

test('stairs continue and return when pathfinder stops at cell edges instead of centers', async () => {
  const f = worldFixture({ solid: true, startY: 2 });
  const originalGoto = f.bot.pathfinder.goto;
  f.bot.pathfinder.goto = async goal => { await originalGoto(goal); f.bot.entity.position = f.bot.entity.position.offset(0.45,0,0.45); };
  await assert.rejects(runBranchMining('iron', f.bot, f.state, { saveMiningRoutes: false }, 1, { y: 0, strategy: 'branch', mainLength: 1, branchLength: 1 }), /搜索完成/);
  assert(f.digs.length > 0);
  assert(f.state._lastMiningPlan.steps >= 3);
  assert.equal(f.state._lastMiningPlan.returned, true);
  assert(f.bot.entity.position.floored().equals(new Vec3(0,2,0)));
});

test('navigation splits long travel, confirms actual arrival and restores its movement policy', async () => {
  const f = worldFixture();
  const previous = f.bot.pathfinder.movements;
  const result = await navigation.navigateTo(30, 1, 0, f.bot, { state: f.state, range: 0 });
  assert.equal(result.arrived, true);
  assert(f.travel.length >= 3);
  assert.equal(f.bot.pathfinder.movements, previous);
  assert.equal(f.state._navigationTask, null);
  assert(f.state._lastNavigationTrail.points.length >= 3);
});

test('resolved pathfinder promises cannot falsely report arrival', async () => {
  const f = worldFixture();
  let attempts = 0;
  f.bot.pathfinder.goto = async () => { attempts++; };
  await assert.rejects(navigation.navigateTo(10, 1, 0, f.bot, { state: f.state }), /没有实际到达/);
  assert.equal(attempts, 2);
  assert.equal(f.state._navigationTask, null);
});

test('stop aborts pending navigation without late arrival or stale goals', async () => {
  const f = worldFixture();
  f.bot.pathfinder.goto = () => new Promise(() => {});
  const pending = navigation.navigateTo(10, 1, 0, f.bot, { state: f.state });
  await turn(); stopCurrentTask(f.bot, f.state);
  await assert.rejects(pending, error => error.code === 'TASK_CANCELLED');
  assert.equal(f.state._navigationTask, null);
  assert.equal(f.state.mode, 'idle');
});

test('return routes reject dimension changes and erase already-returned loops', async () => {
  const f = worldFixture();
  const trail = [{ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }];
  navigation.appendTrail(trail, { x: 1, y: 1, z: 0 });
  assert.equal(trail.length, 2);
  f.state._lastExpeditionRoute = { dimension: 'the_nether', points: trail };
  await assert.rejects(navigation.returnAlongTrail(f.bot, f.state), /其他维度/);
});

test('branch mining follows both ore variants and a connected vein; stops at the requested ore count', async () => {
  const f = worldFixture({ solid: true, startY: 0 });
  f.set(new Vec3(2, 0, 0), 'iron_ore');
  f.set(new Vec3(3, 0, 0), 'deepslate_iron_ore');
  f.set(new Vec3(3, 1, 0), 'iron_ore');
  f.set(new Vec3(4, 1, 0), 'iron_ore');
  const result = await runBranchMining('iron', f.bot, f.state, { saveMiningRoutes: false }, 3, { y: 0, strategy: 'branch', mainLength: 4, branchLength: 2 });
  assert.equal(result.mined, 3);
  assert.equal(f.inventory.get('raw_iron'), 3);
  assert.equal(f.bot.blockAt(new Vec3(4, 1, 0)).name, 'iron_ore');
  assert.equal(result.returned, true);
  assert.equal(f.state._miningTask, null);
  assert(f.bot.entity.position.floored().equals(new Vec3(0, 0, 0)));
});

test('branch strategy harvests visible deep diamond before leaving for a different height',async()=>{
  const f=worldFixture({solid:true,startY:0});
  f.set(new Vec3(4,1,0),'deepslate_diamond_ore');f.set(new Vec3(3,1,0),'air');
  const result=await runBranchMining('diamond',f.bot,f.state,{saveMiningRoutes:false},1,{y:-4,strategy:'branch'});
  assert.equal(result.mined,1);assert.equal(result.excavated,1);assert.equal(result.plan.steps,0);
  assert.equal(f.inventory.get('diamond'),1);
});

test('nearby ore mining also uses the confirmed manual dig path instead of the collection plugin',async()=>{
  const f=worldFixture({solid:true,startY:0});
  f.set(new Vec3(1,0,0),'deepslate_diamond_ore');
  f.bot.collectBlock.collect=async()=>{throw new Error('must not use old collection dig');};
  const result=await req('./modules/miner').startMiner('diamond_ore',f.bot,f.state,{saveMiningRoutes:false},1,{strategy:'nearby'});
  assert.equal(result.mined,1);assert.equal(f.inventory.get('diamond'),1);
  assert.equal(f.digs.length,1);
});

test('systematic search excavates spaced left/right branches and reports partial results truthfully', async () => {
  const f = worldFixture({ solid: true, startY: 0 });
  await assert.rejects(runBranchMining('iron', f.bot, f.state, { saveMiningRoutes: false }, 1, { y: 0, strategy: 'branch', mainLength: 4, branchLength: 2, spacing: 2 }), /搜索完成.*0\/1/);
  for (const x of [2, 4]) for (const z of [-2, 2]) assert.equal(f.bot.blockAt(new Vec3(x, 0, z)).name, 'air');
  assert.equal(f.state._lastMiningPlan.steps, 12);
  assert.equal(f.state._lastMiningPlan.mined, 0);
  assert.equal(f.state._lastMiningPlan.returned, true);
  assert.equal(f.state.mode, 'idle');
});

test('a descent constructs actual staircase clearance and returns along the same safe steps', async () => {
  const f = worldFixture({ solid: true, startY: 2 });
  await assert.rejects(runBranchMining('iron', f.bot, f.state, { saveMiningRoutes: false }, 1, { y: 0, strategy: 'branch', mainLength: 1, branchLength: 1 }), /搜索完成/);
  assert.equal(f.bot.blockAt(new Vec3(1, 3, 0)).name, 'air');
  assert.equal(f.bot.blockAt(new Vec3(2, 0, 0)).name, 'air');
  assert(f.bot.entity.position.floored().equals(new Vec3(0, 2, 0)));
  for (let i = 1; i < f.travel.length; i++) assert(Math.abs(f.travel[i].y - f.travel[i - 1].y) <= 1);
});

test('missing tool blocks strategy before any terrain changes', async () => {
  const f = worldFixture({ solid: true, startY: 0 });
  f.inventory.delete('iron_pickaxe');
  await assert.rejects(runBranchMining('diamond', f.bot, f.state, { saveMiningRoutes: false }, 1, { y: 0 }), /工具/);
  assert.equal(f.digs.length, 0);
  assert.equal(f.state.mode, 'idle');
});

test('stop interrupts an unfinished tunnel dig and prevents subsequent staircase/branch moves', async () => {
  const f = worldFixture({ solid: true, startY: 0 });
  let started;
  const digStarted = new Promise(resolve => { started = resolve; });
  f.bot.dig = () => { started(); return new Promise(() => {}); };
  const pending = runBranchMining('iron', f.bot, f.state, { saveMiningRoutes: false }, 1, { y: 0, strategy: 'branch', returnHome: false });
  await digStarted; stopCurrentTask(f.bot, f.state);
  await assert.rejects(pending, error => error.code === 'TASK_CANCELLED');
  assert.equal(f.travel.length, 0);
  assert.equal(f.state._miningTask, null);
  assert.equal(f.state.mode, 'idle');
});

test('low food halts branch excavation before any blocks change', async () => {
  const f = worldFixture({ solid: true, startY: 0 });
  f.bot.food = 4;
  await assert.rejects(runBranchMining('iron', f.bot, f.state, { saveMiningRoutes: false }, 1, { y: 0, strategy: 'branch' }), /饱食/);
  assert.equal(f.digs.length, 0);
});

test('frontier scoring prefers unvisited ground over repeated routes', () => {
  const f = worldFixture();
  const map = { cells: {}, landmarks: [] };
  const target = new Vec3(0, 1, -100);
  const first = exploration.frontierCandidates(f.bot, map, target)[0].point;
  for (let i = 0; i < 10; i++) exploration.rememberCell(map, first, 'visited');
  const alternative = exploration.frontierCandidates(f.bot, map, target)[0].point;
  assert.notEqual(exploration.cellKey(first), exploration.cellKey(alternative));
});

test('terrain exploration surveys safely, remembers visited areas and returns on request', async () => {
  const f = worldFixture();
  const result = await exploration.exploreTerrain(f.bot, f.state, { saveExplorationRoutes: false }, { direction: 'north', distance: 32 });
  assert.equal(result.arrived, true);
  assert(result.walked >= 25);
  assert(Object.keys(f.state._explorationMap.cells).length >= 3);
  assert.equal(f.state.mode, 'idle');
  await navigation.returnAlongTrail(f.bot, f.state);
  assert(f.bot.entity.position.floored().equals(new Vec3(0, 1, 0)));
});

test('water/lava or cliff-like unsupported terrain stops exploration without random wandering', async () => {
  const f = worldFixture({ lavaFloor: true });
  await assert.rejects(exploration.exploreTerrain(f.bot, f.state, { saveExplorationRoutes: false }, { direction: 'north', distance: 32 }), /路线均受阻/);
  assert.equal(f.travel.length, 0);
  assert.equal(f.state._wanderEnabled, false);
  assert.equal(f.state.mode, 'idle');
  assert(Object.values(f.state._explorationMap.cells).some(cell => cell.status === 'blocked'));
});

test('explicit !branch command bypasses the AI and preserves zero-height and ore-count arguments', async () => {
  const f = worldFixture({ solid: true, startY: 0 });
  f.set(new Vec3(2, 0, 0), 'iron_ore');
  const ai = req('./modules/ai');
  const original = ai.processMessage;
  let apiCalls = 0;
  ai.processMessage = async () => { apiCalls++; throw new Error('AI should not be called'); };
  const chat = req('./modules/chat');
  try {
    chat.handleChat('Owner', '!branch iron 1 0 east', f.bot, f.state, { owner: 'Owner', saveMiningRoutes: false });
    for (let turnCount = 0; turnCount < 100 && !f.chats.some(message => message.startsWith('本轮挖到')); turnCount++) await turn();
    assert.equal(apiCalls, 0);
    assert.equal(f.state._lastMiningPlan.y, 0);
    assert.equal(f.state._lastMiningPlan.targetCount, 1);
    assert.equal(f.state._lastMiningPlan.mined, 1);
    assert(f.chats.some(message => message.startsWith('本轮挖到')));
  } finally { ai.processMessage = original; }
});

test('coordinate scan finds buried normal and deep ores and tolerates palette blocks without positions',()=>{
  const f=worldFixture({solid:true,startY:0});f.set(new Vec3(10,0,0),'diamond_ore');f.set(new Vec3(12,0,0),'deepslate_diamond_ore');
  assert.deepEqual(scanTargets(f.bot,['diamond_ore','deepslate_diamond_ore']).map(p=>p.x),[10,12]);
  assert.deepEqual(scanTargets(f.bot,['diamond_ore','deepslate_diamond_ore'],{excluded:new Set(['10,0,0'])}).map(p=>p.x),[12]);
});

test('target tunnel plans a staircase to buried ore without unsafe vertical drops',async()=>{
  const f=worldFixture({solid:true,startY:0}),origin=new Vec3(0,0,0),target=new Vec3(8,-4,0);
  f.set(target,'deepslate_diamond_ore');
  const result=await planTargetTunnel(f.bot,origin,target);
  assert(result.path.length);let from=origin;
  for(const next of result.path){assert.equal(terrain.inspectTunnelStep(f.bot,from,next).safe,true);assert(Math.abs(next.y-from.y)<=1);assert.equal(Math.abs(next.x-from.x)+Math.abs(next.z-from.z),1);from=next;}
  assert(result.path.at(-1).equals(target)||result.path.at(-1).equals(target.offset(0,-1,0)));
});

test('target tunnel detours around protected buildings and lava rather than breaking through them',async()=>{
  const f=worldFixture({solid:true,startY:0}),target=new Vec3(7,0,0);
  f.set(target,'diamond_ore');
  for(let y=-4;y<=4;y++)f.set(new Vec3(2,y,0),'crafting_table');
  f.set(new Vec3(4,0,0),'lava');
  const result=await planTargetTunnel(f.bot,new Vec3(0,0,0),target);
  assert(result.path);assert(result.path.some(p=>p.z!==0));
  let from=new Vec3(0,0,0);
  for(const next of result.path){const inspection=terrain.inspectTunnelStep(f.bot,from,next);assert(inspection.safe);assert(inspection.blocks.every(b=>b.name!=='crafting_table'&&b.name!=='lava'));from=next;}
});

test('target planner excludes blocked edges on replan and remains interruptible',async()=>{
  const f=worldFixture({solid:true,startY:0}),target=new Vec3(8,0,0);
  f.set(target,'diamond_ore');
  const result=await planTargetTunnel(f.bot,new Vec3(0,0,0),target,{blockedEdges:new Set(['0,0,0>1,0,0'])});
  assert(result.path);assert(!result.path[0].equals(new Vec3(1,0,0)));
  await assert.rejects(planTargetTunnel(f.bot,new Vec3(0,0,0),target,{assertActive:()=>{const e=new Error('stopped');e.code='TASK_CANCELLED';throw e;}}),{code:'TASK_CANCELLED'});
});

test('buried known diamond coordinates are pursued before the default mineral height',async()=>{
  const f=worldFixture({solid:true,startY:0});f.set(new Vec3(10,0,0),'deepslate_diamond_ore');
  f.bot.canDigBlock=b=>b.position.offset(.5,.5,.5).distanceTo(f.bot.entity.position.offset(0,1.65,0))<=5.1;
  const result=await runBranchMining('diamond',f.bot,f.state,{saveMiningRoutes:false},1,{y:-20,strategy:'auto'});
  assert.equal(result.mined,1);assert.equal(f.inventory.get('diamond'),1);assert.equal(result.returned,true);
  assert.deepEqual([result.plan.lockedTarget.x,result.plan.lockedTarget.y,result.plan.lockedTarget.z],[10,0,0]);
  assert(f.travel.every(p=>p.y===0));assert(f.chats.some(m=>m.includes('(10,0,0)')));
});

test('ordinary natural target blocks use coordinate tunneling and keep the requested count',async()=>{
  const f=worldFixture({solid:true,startY:0});f.set(new Vec3(8,0,0),'dirt');f.set(new Vec3(9,0,0),'dirt');
  const result=await req('./modules/miner').startMiner('dirt',f.bot,f.state,{saveMiningRoutes:false},2,{strategy:'targeted'});
  assert.equal(result.mined,2);assert.equal(result.plan.ordinary,true);assert(result.plan.lockedTarget);
  assert.equal(f.digs.filter(b=>b.name==='dirt').length,2);
});

test('ordinary coordinate targets work at deep tunnel heights without mineral-layer restrictions',()=>{
  const f=worldFixture({solid:true,startY:-60});
  assert.equal(plan.buildMiningPlan(f.bot,'dirt').y,-60);
  assert.equal(plan.buildMiningPlan(f.bot,'dirt').ordinary,true);
});

test('targeted-only requests do not excavate speculative branches when no loaded target exists',async()=>{
  const f=worldFixture({solid:true,startY:0});
  await assert.rejects(runBranchMining('diamond',f.bot,f.state,{saveMiningRoutes:false},1,{strategy:'targeted'}),/没有更多可安全到达/);
  assert.equal(f.digs.length,0);assert.equal(f.state.mode,'idle');
});

test('a disappearing locked target is discarded without digging a tunnel to its old location',async()=>{
  const f=worldFixture({solid:true,startY:0}),target=new Vec3(10,0,0);f.set(target,'diamond_ore');
  const chat=f.bot.chat;f.bot.chat=message=>{chat(message);if(message.includes('发现')&&message.includes('(10,0,0)'))f.set(target,'stone');};
  await assert.rejects(runBranchMining('diamond',f.bot,f.state,{saveMiningRoutes:false},1,{strategy:'targeted'}),/没有更多可安全到达/);
  assert.equal(f.digs.length,0);assert.equal(f.state._miningTask,null);
});

test('new hazards encountered after a target plan is built trigger replanning around the obstacle',async()=>{
  const f=worldFixture({solid:true,startY:0});f.set(new Vec3(10,0,0),'diamond_ore');
  const goto=f.bot.pathfinder.goto;let changed=false;
  f.bot.pathfinder.goto=async goal=>{await goto(goal);if(!changed){changed=true;f.set(new Vec3(4,0,0),'lava');}};
  const result=await runBranchMining('diamond',f.bot,f.state,{saveMiningRoutes:false},1,{strategy:'targeted'});
  assert.equal(result.mined,1);assert(result.plan.lockedTarget.replans>0);assert(f.travel.some(p=>p.z!==0||p.y!==0));assert.equal(f.bot.blockAt(new Vec3(4,0,0)).name,'lava');
});

test('unloaded terrain cannot be used as a fabricated tunnel and planning has a finite node budget',async()=>{
  const f=worldFixture({solid:true,startY:0}),blockAt=f.bot.blockAt;
  f.bot.blockAt=p=>p.x===3?null:blockAt(p);
  const result=await planTargetTunnel(f.bot,new Vec3(0,0,0),new Vec3(8,0,0),{maxNodes:128});
  assert.equal(result.path,null);assert(result.examined<=128);assert.equal(f.digs.length,0);
});

