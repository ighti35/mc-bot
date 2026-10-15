const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const registry=require('minecraft-data')('1.21.11');
const {Vec3}=require('vec3');
const Block=require('prismarine-block')(registry);
const {Movements}=require('mineflayer-pathfinder');
const Move=require('mineflayer-pathfinder/lib/move');
const Chat=require('prismarine-chat')('1.21.11');
const {locateTarget,parseLocateReply,resolveTarget,detectLocateRequest}=require('../modules/locate');
const {travelJourney,journeyCandidates,journeyMovements,landingAt,bridgeMaterials}=require('../modules/journey');
const {stopCurrentTask}=require('../modules/task-control');
const {planJourney}=require('../modules/journey-planner');

function fixture({surface=0}={}){
  const bot=new EventEmitter(),cells=new Map(),items=[{name:'dirt',count:32,type:registry.itemsByName.dirt.id},{name:'diamond',count:2,type:registry.itemsByName.diamond.id}],travel=[],chats=[];
  Object.assign(bot,{registry,health:20,food:20,game:{dimension:'overworld',minY:-64,height:384},entity:{position:new Vec3(.5,surface+1,.5)},entities:{},players:{},inventory:{items:()=>items},clearControlStates(){},stopDigging(){},chat:m=>chats.push(m),findBlocks:()=>[],
    blockAt(p){if(!p)return null;const name=cells.get(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`)||(p.y<=surface?'stone':'air');if(name==='unloaded')return null;const b=Block.fromStateId(registry.blocksByName[name].minStateId,0);b.position=p.floored();b.biome=registry.biomesByName.plains.id;return b;}});
  bot.pathfinder={setGoal(){},setMovements:m=>{bot.pathfinder.movements=m;},goto:async g=>{travel.push({point:new Vec3(g.x,g.y,g.z),movements:bot.pathfinder.movements});bot.entity.position=new Vec3(g.x+.5,g.y,g.z+.5);}};
  bot.pathfinder.movements=new Movements(bot);
  const state={mode:'idle',stats:{}};
  const set=(x,y,z,name)=>cells.set(`${x},${y},${z}`,name);
  const success=(kind,x=100,z=-200,y='~')=>new Chat({translate:`commands.locate.${kind}.success`,with:[{text:kind==='structure'?'#minecraft:village':'minecraft:plains'},{text:`[${x}, ${y}, ${z}]`},{text:'223'}]});
  return {bot,state,set,items,travel,chats,success};
}

test('terrain A* escapes a U-shaped ridge by initially moving away from the destination',async()=>{
  const f=fixture();f.items[0].count=0;
  for(let y=1;y<=8;y++){
    for(let z=-6;z<=6;z++)f.set(5,y,z,'stone');
    for(let x=-5;x<=5;x++){f.set(x,y,-6,'stone');f.set(x,y,6,'stone');}
  }
  const plan=await planJourney(f.bot,{cells:{}},new Vec3(12,1,0),journeyMovements(f.bot,'bridge'),{range:0,timeout:2000,segmentLength:4});
  assert(plan);assert.equal(plan.status,'success');
  assert(plan.path.some(p=>p.x<-5),'must leave the opening behind the bot');
  assert(plan.point.x<0,'the first segment must accept moving away from the goal');
  assert.deepEqual(plan.path.at(-1),{x:12,y:1,z:0});
});

test('terrain A* prefers a short dry detour to consuming blocks across a cliff',async()=>{
  const f=fixture();
  for(let x=1;x<=3;x++)for(let y=-12;y<=0;y++)f.set(x,y,0,'air');
  const plan=await planJourney(f.bot,{cells:{}},new Vec3(8,1,0),journeyMovements(f.bot,'bridge'),{range:0});
  assert(plan);assert.equal(plan.status,'success');assert.equal(plan.gaps,0);
  assert(plan.path.some(p=>p.z!==0));
});

test('terrain A* stops at the loaded boundary and remains cancellable during planning',async()=>{
  const f=fixture(),blockAt=f.bot.blockAt;
  f.bot.blockAt=p=>p.x>8?null:blockAt(p);
  const plan=await planJourney(f.bot,{cells:{}},new Vec3(100,1,0),journeyMovements(f.bot,'bridge'),{timeout:80,range:0});
  assert(plan);assert(plan.path.every(p=>p.x<=7));assert.notEqual(plan.status,'success');
  await assert.rejects(planJourney(f.bot,{cells:{}},new Vec3(100,1,0),journeyMovements(f.bot,'bridge'),{},()=>{const e=new Error('stop');e.code='TASK_CANCELLED';throw e;}),{code:'TASK_CANCELLED'});
});
test('locate parses real translated coordinate components, including unknown surface Y',()=>{
  const f=fixture();assert.deepEqual(parseLocateReply(f.success('structure'),'structure'),{x:100,y:null,z:-200});
  assert.deepEqual(parseLocateReply(f.success('biome',-10,20,64),'biome'),{x:-10,y:64,z:20});
  assert.equal(resolveTarget(f.bot,'structure','village').id,'#minecraft:village');
  assert.equal(resolveTarget(f.bot,'biome','樱花林').id,'minecraft:cherry_grove');
  assert.throws(()=>resolveTarget(f.bot,'biome','plains\n/give @s diamond'),/无效/);
});
test('locate sends the actual command and waits for a system response rather than a player chat',async()=>{
  const f=fixture();let completed=false;
  const task=locateTarget(f.bot,f.state,{kind:'structure',target:'村庄',locateTimeout:500}).then(r=>{completed=true;return r;});
  assert.equal(f.chats[0],'/locate structure #minecraft:village');
  f.bot.emit('message',f.success('structure'),'chat');await new Promise(r=>setImmediate(r));assert.equal(completed,false);
  f.bot.emit('message',f.success('structure'),'system');const result=await task;
  assert.equal(result.x,100);assert.equal(f.state._locateTask,null);assert.equal(f.bot.listenerCount('message'),0);
});
test('permission failure and stop leave no stale locate listener or fabricated destination',async()=>{
  const f=fixture();const denied=locateTarget(f.bot,f.state,{kind:'biome',target:'plains',locateTimeout:500});
  f.bot.emit('message',new Chat({translate:'commands.generic.permission'}),'system');await assert.rejects(denied,/服务器定位失败/);
  const pending=locateTarget(f.bot,f.state,{kind:'biome',target:'plains',locateTimeout:500});stopCurrentTask(f.bot,f.state);
  await assert.rejects(pending,{code:'TASK_CANCELLED'});assert.equal(f.bot.listenerCount('message'),0);assert.equal(f.state._lastLocatedTarget,undefined);
});
test('natural village and biome requests route to locate rather than random exploration',()=>{
  assert.deepEqual(detectLocateRequest('带我去沙漠神殿'),{kind:'structure',target:'desert_pyramid',guide:true});
  assert.deepEqual(detectLocateRequest('带我去丛林神庙'),{kind:'structure',target:'jungle_pyramid',guide:true});
  assert.deepEqual(detectLocateRequest('找下界要塞'),{kind:'structure',target:'fortress',guide:true});
  assert.deepEqual(detectLocateRequest('带我找个村庄'),{kind:'structure',target:'village',guide:true});
  assert.equal(detectLocateRequest('带我去樱花林').target,'cherry_grove');assert.equal(detectLocateRequest('不要去村庄'),null);
});
test('walking movements allow water but forbid high climbs, digging and tower shortcuts',()=>{
  const f=fixture();const m=journeyMovements(f.bot,'walk');
  assert(!m.blocksToAvoid.has(registry.blocksByName.water.id));assert(m.blocksToAvoid.has(registry.blocksByName.lava.id));
  assert.equal(m.canDig,false);assert.equal(m.allowParkour,false);assert.equal(m.allow1by1towers,false);
  assert.equal(m.exclusionStep(f.bot.blockAt(new Vec3(2,8,0))),Infinity);
});
test('real movement generator can bridge a gap with inventory cubes and declines when no block budget remains',()=>{
  const f=fixture();f.set(1,0,0,'air');
  const m=journeyMovements(f.bot,'bridge',{bridgeBudget:2});
  assert.deepEqual(bridgeMaterials(f.bot).map(i=>i.name),['dirt']);
  const step=m.getNeighbors(new Move(0,1,0,m.countScaffoldingItems(),0)).find(n=>n.x===1&&n.y===1&&n.z===0);
  assert(step);assert.equal(step.toPlace.length,1);assert.equal(m.countScaffoldingItems(),2);
  f.items[0].count-=2;assert.equal(m.countScaffoldingItems(),0);
  assert(!m.getNeighbors(new Move(0,1,0,0,0)).some(n=>n.x===1&&n.y===1&&n.z===0));
});
test('water has a surface waypoint and uses native swimming rather than being classified as a cliff',()=>{
  const f=fixture({surface:-10});
  for(let x=-2;x<=15;x++)for(let z=-2;z<=2;z++)for(let y=-9;y<=0;y++)f.set(x,y,z,'water');
  f.bot.entity.position=new Vec3(.5,1,.5);f.set(0,0,0,'stone');
  const landing=landingAt(f.bot,8,0,1);assert.equal(landing.mode,'swim');assert.equal(landing.point.y,0);
  const candidates=journeyCandidates(f.bot,{cells:{},landmarks:[]},new Vec3(12,1,0));
  assert(candidates.some(c=>c.mode==='swim'));
  const m=journeyMovements(f.bot,'swim');assert.equal(m.scafoldingBlocks.length,0);
  assert(m.getNeighbors(new Move(0,1,0,0,0)).some(n=>n.x===1&&n.z===0));
});
test('dry cliff candidates require actual bridge material and refuse lava or unknown floor columns',()=>{
  const f=fixture();for(let x=2;x<=9;x++)for(let z=-2;z<=2;z++)for(let y=-10;y<=0;y++)f.set(x,y,z,'air');
  const map={cells:{},landmarks:[]},target=new Vec3(16,1,0);
  assert(journeyCandidates(f.bot,map,target).some(c=>c.mode==='bridge'));
  f.items[0].count=0;assert(!journeyCandidates(f.bot,{cells:{},landmarks:[]},target).some(c=>c.mode==='bridge'));
});
test('short overland journey records checkpoints, confirms arrival and clears the task',async()=>{
  const f=fixture();const result=await travelJourney(f.bot,f.state,{saveExplorationRoutes:false},{x:32,z:0,lead:false});
  assert(result.arrived);assert(result.walked>=28);assert(f.state._lastExpeditionRoute.adaptive);assert.equal(f.state._journeyTask,null);assert.equal(f.state.mode,'idle');
});
test('leading waits for a distant owner and stop interrupts that wait',async()=>{
  const f=fixture();f.bot.players.Owner={entity:{position:new Vec3(100,1,0)}};
  const pending=travelJourney(f.bot,f.state,{owner:'Owner',saveExplorationRoutes:false},{x:32,z:0,lead:true});
  await new Promise(r=>setImmediate(r));assert.equal(f.travel.length,0);assert(f.chats.some(m=>m.includes('等你跟上')));
  stopCurrentTask(f.bot,f.state);await assert.rejects(pending,{code:'TASK_CANCELLED'});assert.equal(f.state._journeyTask,null);
});

test('small hills stay climbable in the real movement generator but high ridges produce detours',()=>{
  const f=fixture();f.set(1,1,0,'stone');
  const m=journeyMovements(f.bot,'walk');
  assert(m.getNeighbors(new Move(0,1,0,0,0)).some(p=>p.x===1&&p.y===2&&p.z===0));
  for(let x=4;x<=10;x++)for(let z=-2;z<=2;z++)for(let y=1;y<=9;y++)f.set(x,y,z,'stone');
  const candidates=journeyCandidates(f.bot,{cells:{},landmarks:[]},new Vec3(24,1,0));
  assert(candidates.length);assert(candidates[0].point.z!==0);assert(candidates.every(c=>c.point.y<=5));
});

test('a one-block cliff can be bridged with exactly one expendable block',()=>{
  const f=fixture();f.items[0].count=1;
  for(let z=-4;z<=4;z++)for(let y=-10;y<=0;y++)f.set(3,y,z,'air');
  const candidates=journeyCandidates(f.bot,{cells:{},landmarks:[]},new Vec3(12,1,0));
  assert(candidates.some(c=>c.mode==='bridge'));
});

test('journey does not claim biome arrival from horizontal coordinates alone',async()=>{
  const f=fixture();
  await assert.rejects(travelJourney(f.bot,f.state,{saveExplorationRoutes:false},{x:1,z:0,biome:'desert'}),/尚未确认进入/);
  assert.equal(f.state._lastExplorationResult.arrived,false);
});

test('biome guidance crosses the local boundary before confirming arrival',async()=>{
  const f=fixture(),blockAt=f.bot.blockAt;
  f.bot.blockAt=p=>{const b=blockAt(p);if(b&&p.x>=3)b.biome=registry.biomesByName.desert.id;return b;};
  const result=await travelJourney(f.bot,f.state,{saveExplorationRoutes:false},{x:3,z:0,biome:'desert'});
  assert(result.arrived);assert.equal(result.biome,'desert');assert(f.bot.entity.position.x>=3);
});

test('standing on village paths or slabs confirms the supported surface without accepting a lower full-block step',async()=>{
  const f=fixture();f.set(2,0,0,'dirt_path');
  const {standingPoint}=require('../modules/terrain');const {navigateTo}=require('../modules/navigation');
  f.bot.entity.position=new Vec3(2.5,.9375,.5);assert.equal(standingPoint(f.bot).y,1);
  const result=await navigateTo(2,1,0,f.bot,{state:f.state,surface:true,range:0,exact:true});assert(result.arrived);assert.equal(f.travel.length,0);
  f.set(2,0,0,'stone');f.bot.entity.position=new Vec3(2.5,0,.5);assert.equal(standingPoint(f.bot).y,0);
});

test('server 1.21.11 namespaced biome registry and object-valued block biome decode correctly',()=>{
  const f=fixture(),plain=registry.biomesByName.plains;
  f.bot.registry={...registry,biomesByName:{'minecraft:plains':plain},biomesArray:[{...plain,name:'minecraft:plains'}]};
  assert.equal(resolveTarget(f.bot,'biome','plains').id,'minecraft:plains');
  const {biomeName}=require('../modules/terrain');assert.equal(biomeName(f.bot,{biome:{id:plain.id,name:''}}),'plains');
});

test('come/goto reuse adaptive terrain routing without claiming arrival beneath a high target',async()=>{
  const f=fixture();const {goTo}=require('../modules/navigation-task');
  await assert.rejects(goTo(f.bot,f.state,{x:1,y:20,z:0},{timeout:30,config:{saveExplorationRoutes:false}}),/时间上限|不允许垫高/);
  assert.equal(f.state._lastExplorationResult.arrived,false);
});

test('come can plan jump-placement to a high platform using actual inventory, while ordinary journeys cannot tower',async()=>{
  const f=fixture();f.set(2,7,0,'dirt');
  const normal=journeyMovements(f.bot,'bridge',{targetY:8});
  assert.equal(normal.allow1by1towers,false);
  const climbing=journeyMovements(f.bot,'bridge',{targetY:8,allowTower:true,bridgeBudget:8});
  const jump=climbing.getNeighbors(new Move(0,1,0,8,0)).find(node=>node.y===2&&node.x===0&&node.z===0);
  assert(jump);assert.equal(jump.toPlace[0].jump,true);assert.equal(jump.remainingBlocks,7);
  const plan=await planJourney(f.bot,{cells:{}},new Vec3(2,8,0),climbing,{targetY:8,range:1,timeout:2000,searchRadius:8});
  assert(plan);assert.equal(plan.status,'success');assert(plan.gaps>0);
  assert(plan.path.some(node=>node.y>=7));
  const limited=journeyMovements(f.bot,'bridge',{targetY:8,allowTower:true,bridgeBudget:2});
  assert.equal(await planJourney(f.bot,{cells:{}},new Vec3(0,8,0),limited,{targetY:8,range:0,timeout:100}),null);
});

test('an unreachable raised player gets an accurate material-budget error instead of a generic terrain failure',async()=>{
  const f=fixture();f.items[0].count=0;
  await assert.rejects(travelJourney(f.bot,f.state,{saveExplorationRoutes:false},{x:0,z:0,targetY:20,y:20,allowTower:true}),/方块只有 0 个/);
  assert.equal(f.state._lastExplorationResult.arrived,false);
});

test('navigation ignores an empty provisional A* tick and waits for the actual goal event',async()=>{
  const f=fixture(),{navigateTo}=require('../modules/navigation');
  f.bot.pathfinder.getPathFromTo=function*(){};
  f.bot.pathfinder.setGoal=goal=>{
    f.bot.emit('goal_updated',goal);
    if(goal){
      setImmediate(()=>f.bot.emit('path_update',{status:'partial',path:[]}));
      setTimeout(()=>{f.bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5);f.bot.emit('goal_reached',goal);},70);
    }
  };
  let completed=false;
  const task=navigateTo(2,1,0,f.bot,{state:f.state,exact:true,range:0,saveTrail:false}).then(result=>{completed=true;return result;});
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(completed,false);
  assert((await task).arrived);
  assert.equal(f.bot.listenerCount('path_update'),0);assert.equal(f.bot.listenerCount('goal_reached'),0);
});

test('come replans to the player current location instead of climbing toward an obsolete snapshot',async()=>{
  const f=fixture(),{goTo}=require('../modules/navigation-task');
  let player=new Vec3(30,1,0),moves=0;
  f.bot.pathfinder.goto=async goal=>{
    f.bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5);
    if(++moves===1)player=new Vec3(-8,1,0);
  };
  const result=await goTo(f.bot,f.state,player,{getTarget:()=>player,range:2,allowTower:true,config:{saveExplorationRoutes:false}});
  assert(result.arrived);assert.equal(result.target.x,-8);assert(f.bot.entity.position.x<0);assert(moves>=2);
});
