const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('minecraft-data')('1.21.11');
const { Vec3 } = require('vec3');
const Block = require('prismarine-block')(registry);
const { Movements } = require('mineflayer-pathfinder');
const { collectWood } = require('../modules/lumberjack');
const { collectNearbyItems } = require('../modules/item-pickup');
const { stopCurrentTask } = require('../modules/task-control');

function fixture() {
  const cells = new Map(), inventory = new Map([['netherite_axe',1],['netherite_pickaxe',1]]), digs = [], equipped = [];
  const key = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
  const bot = {
    registry, health: 20, food: 20, game: { dimension: 'overworld', minY: -64, height: 384 },
    entity: { position: new Vec3(.5,1,.5), effects: {} }, entities: {},
    clearControlStates() {}, stopDigging() {},
    blockAt(p) { const b = Block.fromStateId(registry.blocksByName[cells.get(key(p)) || (p.y < 1 ? 'stone' : 'air')].minStateId,0); b.position = p.floored(); return b; },
    inventory: { items: () => [...inventory].map(([name,count]) => ({ name,count,type: registry.itemsByName[name].id, durabilityUsed: 0 })), emptySlotCount: () => 30 },
    findBlocks(o) { return [...cells].map(([k]) => new Vec3(...k.split(',').map(Number))).filter(p => o.matching(bot.blockAt(p)) && p.distanceTo(bot.entity.position) < o.maxDistance).slice(0,o.count); },
    canDigBlock: b => b.position.offset(.5,.5,.5).distanceTo(bot.entity.position.offset(0,1.62,0)) < 4.5,
    equip: async item => { await new Promise(r => setImmediate(r)); equipped.push(item.name); bot.heldItem = item; },
    dig: async block => { assert.equal(bot.heldItem.name,'netherite_axe'); digs.push(block.position); cells.set(key(block.position),'air'); inventory.set(block.name,(inventory.get(block.name) || 0)+1); },
  };
  bot.pathfinder = { setGoal() {}, setMovements: m => { bot.pathfinder.movements = m; }, goto: async g => { bot.entity.position = new Vec3(g.x+.5,g.y,g.z+.5); } };
  bot.pathfinder.movements = new Movements(bot);
  const state = { mode:'idle',stats:{} };
  const tree = (x,z,height=4) => { for(let y=1;y<=height;y++) cells.set(`${x},${y},${z}`,'oak_log'); };
  return { bot,state,cells,inventory,digs,equipped,tree };
}
test('twenty logs await twenty axe-equipped cuts across multiple trees and count actual inventory gain', async () => {
  const f=fixture(); for(let x=2;x<=22;x+=4) f.tree(x,0);
  const result=await collectWood(f.bot,f.state,{},20);
  assert.equal(result.chopped,20); assert.equal(result.collected,20); assert.equal(f.digs.length,20);
  assert(f.equipped.every(name=>name==='netherite_axe')); assert.equal(f.state.mode,'idle'); assert.equal(f.state._chopTask,null);
});
test('no axe fails explicitly and cleans task state', async () => {
  const f=fixture(); f.tree(2,0); f.inventory.delete('netherite_axe');
  await assert.rejects(collectWood(f.bot,f.state,{},20),/斧头/);
  assert.equal(f.digs.length,0); assert.equal(f.state.mode,'idle');
});
test('unreachable high logs are skipped for other trees instead of repeatedly selecting the same trunk',async()=>{
  const f=fixture(); f.cells.set('2,18,0','oak_log'); f.tree(8,0); f.tree(12,0);
  const result=await collectWood(f.bot,f.state,{},8);
  assert.equal(result.collected,8); assert(f.cells.has('2,18,0')); assert.equal(f.state.mode,'idle');
});
test('shortage reports actual partial progress rather than success or hanging',async()=>{
  const f=fixture(); f.tree(2,0,2);
  await assert.rejects(collectWood(f.bot,f.state,{},20),/实际收到 2\/20/);
  assert.equal(f.state._lastChoppingResult.collected,2); assert.equal(f.state.mode,'idle');
});
test('stop interrupts an equip that never completes and prevents digging',async()=>{
  const f=fixture();f.tree(2,0);f.bot.equip=()=>new Promise(()=>{});
  const job=collectWood(f.bot,f.state,{},20);
  setTimeout(()=>stopCurrentTask(f.bot,f.state),20);
  await assert.rejects(job,{code:'TASK_CANCELLED'});assert.equal(f.digs.length,0);assert.equal(f.state.mode,'idle');
});
test('a persistent item entity cannot keep collection waiting indefinitely',async()=>{
  const f=fixture();f.bot.entities[1]={id:1,name:'item',isValid:true,position:new Vec3(2.5,1,.5)};
  const started=Date.now();
  assert.equal(await collectNearbyItems(f.bot,{state:f.state,timeout:150}),0);
  assert(Date.now()-started<1000);assert.equal(f.state._navigationTask,null);
});

test('pickup walks to the item cell and waits for its actual removal',async()=>{
  const f=fixture();const travel=[];
  f.bot.entities[1]={id:1,name:'item',isValid:true,position:new Vec3(2.5,1,.5)};
  f.bot.pathfinder.goto=async g=>{travel.push([g.x,g.y,g.z]);f.bot.entity.position=new Vec3(g.x+.5,g.y,g.z+.5);delete f.bot.entities[1];};
  assert.equal(await collectNearbyItems(f.bot,{state:f.state,timeout:500}),1);
  assert.deepEqual(travel,[[2,1,0]]);
});
