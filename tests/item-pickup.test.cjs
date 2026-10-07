const test=require('node:test');
const assert=require('node:assert/strict');
const registry=require('minecraft-data')('1.21.11');
const {Vec3}=require('vec3');
const Entity=require('prismarine-entity')('1.21.11');
const Item=require('prismarine-item')('1.21.11');
const Block=require('prismarine-block')(registry);
const {Movements}=require('mineflayer-pathfinder');
const {scanDroppedItems,describeDroppedItems,collectNearbyItems,runPickupTask}=require('../modules/item-pickup');
const {buildGameContext}=require('../modules/ai');
const {stopCurrentTask}=require('../modules/task-control');
const {handleChat}=require('../modules/chat');
function drop(id,name='item',item='oak_log',count=7,x=2.5) {
  const e=new Entity(id);e.name=name;e.position=new Vec3(x,1,.5);
  if(item)e.metadata[registry.supportFeature('metadataIxOfItem')]=Item.toNotch(new Item(registry.itemsByName[item].id,count));
  return e;
}
function fixture(){
  const items=[],travel=[];
  const bot={registry,health:20,food:20,game:{dimension:'overworld',minY:-64,height:384,gameMode:'survival'},entity:{position:new Vec3(.5,1,.5)},entities:{},
    inventory:{items:()=>items},clearControlStates(){},stopDigging(){},
    blockAt(p){const b=Block.fromStateId(registry.blocksByName[p.y<1?'stone':'air'].minStateId,0);b.position=p.floored();return b;},
  };
  bot.pathfinder={setGoal(){},setMovements:m=>{bot.pathfinder.movements=m;},goto:async g=>{travel.push([g.x,g.y,g.z]);bot.entity.position=new Vec3(g.x+.5,g.y,g.z+.5);const e=Object.values(bot.entities).find(e=>e.position.distanceTo(bot.entity.position)<1);if(e){const i=e.getDroppedItem();if(i)items.push(i);delete bot.entities[e.id];}}};
  bot.pathfinder.movements=new Movements(bot);
  return {bot,items,travel,state:{mode:'idle',stats:{}}};
}
test('real 1.21.11 item metadata identifies all three dropped-entity names, stack counts and distances',()=>{
  const f=fixture();f.bot.entities={1:drop(1),2:drop(2,'Item','raw_iron',3),3:drop(3,'item_stack','diamond',2),4:drop(4,'zombie'),5:drop(5,'item','dirt',1,40),6:drop(6)};f.bot.entities[6].isValid=false;
  const seen=scanDroppedItems(f.bot);
  assert.deepEqual(seen.map(i=>[i.name,i.count]),[['oak_log',7],['raw_iron',3],['diamond',2]]);
  assert.equal(seen[0].distance,2);assert.match(describeDroppedItems(f.bot),/7x oak_log/);
  assert.match(buildGameContext(f.bot,f.state),/Dropped:\[7x oak_log/);
});
test('entity with pending metadata remains visible and named pickup waits briefly for its item stack',async()=>{
  const f=fixture();const e=drop(1,'item_stack',null);f.bot.entities[1]=e;
  assert.equal(scanDroppedItems(f.bot).length,1);assert.match(describeDroppedItems(f.bot),/unknown_item/);
  setTimeout(()=>{e.metadata=drop(1).metadata;},30);
  await collectNearbyItems(f.bot,{state:f.state,names:['oak_log'],timeout:500});
  assert.equal(f.items[0].name,'oak_log');
});
test('pickup task collects the actual stack into inventory without mining any block',async()=>{
  const f=fixture();f.bot.entities[1]=drop(1);
  const result=await runPickupTask(f.bot,f.state,{item:'oak_log',timeout:500});
  assert.equal(result.collected,7);assert.deepEqual(result.items,[{name:'oak_log',count:7}]);
  assert.equal(f.state.mode,'idle');assert.equal(f.state._pickupTask,null);
});
test('entity disappearance alone is not reported as inventory pickup success',async()=>{
  const f=fixture();f.bot.entities[1]=drop(1);
  f.bot.pathfinder.goto=async g=>{f.bot.entity.position=new Vec3(g.x+.5,g.y,g.z+.5);delete f.bot.entities[1];};
  await assert.rejects(runPickupTask(f.bot,f.state,{timeout:500}),/背包没有增加/);
  assert.equal(f.state.mode,'idle');
});
test('stop cancels pickup navigation and clears the task lock',async()=>{
  const f=fixture();f.bot.entities[1]=drop(1);f.bot.pathfinder.goto=()=>new Promise(()=>{});
  const task=runPickupTask(f.bot,f.state,{timeout:1000});setTimeout(()=>stopCurrentTask(f.bot,f.state),20);
  await assert.rejects(task,{code:'TASK_CANCELLED'});assert.equal(f.state._pickupTask,null);
});

test('!drops reports names and stack counts even while another task is busy',async()=>{
  const f=fixture(),messages=[];f.bot.chat=m=>messages.push(m);f.bot.entities[1]=drop(1);f.state._miningTask={};
  handleChat('Owner','!drops',f.bot,f.state,{owner:'Owner'});
  await new Promise(r=>setImmediate(r));
  assert(messages.some(m=>m.includes('7x oak_log')));
  assert.equal(f.travel.length,0);
});
test('!pickup takes the entity stack and returns actual inventory gain through the command handler',async()=>{
  const f=fixture(),messages=[];f.bot.chat=m=>messages.push(m);f.bot.entities[1]=drop(1);
  handleChat('Owner','!pickup oak_log',f.bot,f.state,{owner:'Owner'});
  await new Promise(r=>setImmediate(r));
  assert.equal(f.items[0].count,7);assert(messages.some(m=>m.includes('7 个 oak_log')));
  assert.equal(f.state._lastActionResult.success,true);
});
