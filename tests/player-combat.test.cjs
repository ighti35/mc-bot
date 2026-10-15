const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const registry=require('minecraft-data')('1.21.11');
const {Movements}=require('mineflayer-pathfinder');
const {huntPlayer,detectPlayerAttack}=require('../modules/player-combat');
const {resolvePlayer,describePlayers}=require('../modules/player-targets');
const {stopCurrentTask}=require('../modules/task-control');
function fixture(){
  const bot=new EventEmitter(),state={mode:'idle'},target={id:2,username:'Owner',uuid:'owner',isValid:true,position:new Vec3(8,64,0)},attacks=[],goals=[];
  const sword={name:'diamond_sword',type:registry.itemsByName.diamond_sword.id,count:1};
  Object.assign(bot,{registry,health:20,entity:{id:1,position:new Vec3(0,64,0)},entities:{2:target},players:{Owner:{uuid:'owner',entity:target}},inventory:{items:()=>[sword]},chat(){},clearControlStates(){},stopDigging(){},lookAt:async()=>{},equip:async()=>{bot.heldItem=sword;},attack:entity=>attacks.push(entity)});
  bot.pathfinder={movements:new Movements(bot),setMovements(m){this.movements=m;},setGoal(goal){goals.push(goal);if(goal?.entity)bot.entity.position=goal.entity.position.offset(-1,0,0);}};
  return {bot,state,target,attacks,goals};
}
test('owner pursuit request is an attack task and negations/questions never start it',()=>{
  assert.deepEqual(detectPlayerAttack('追杀我','Owner'),{player:'Owner'});assert(detectPlayerAttack('attack me','Owner'));
  assert.equal(detectPlayerAttack('不要打我','Owner'),null);assert.equal(detectPlayerAttack('为什么不攻击我','Owner'),null);
});
test('player resolver prefers live entities over stale player-list references and exposes precise current coordinates',()=>{
  const f=fixture();f.bot.players.Owner.entity={id:99,position:new Vec3(100,100,100),isValid:true};
  assert.equal(resolvePlayer(f.bot,'owner'),f.target);assert.match(describePlayers(f.bot,'Owner'),/8\.00,64\.00,0\.00/);
  delete f.bot.entities[2];assert.equal(resolvePlayer(f.bot,'Owner'),null);
});
test('pursuit keeps attacking after arrival and resumes following a moving target',async()=>{
  const f=fixture();setTimeout(()=>{f.target.position=new Vec3(16,64,0);},350);
  const result=await huntPlayer(f.bot,f.state,{owner:'Owner'},{duration:1.4});
  assert(f.attacks.length>=2);assert(f.goals.filter(goal=>goal?.entity).length>=2);assert.equal(result.hits,f.attacks.length);assert.equal(f.state.mode,'idle');assert.equal(f.state._playerCombatTask,null);
});
test('stop interrupts pursuit and death confirmation ends it without waiting for the timeout',async()=>{
  const f=fixture(),task=huntPlayer(f.bot,f.state,{owner:'Owner'},{duration:300});
  setTimeout(()=>stopCurrentTask(f.bot,f.state),150);await assert.rejects(task,{code:'TASK_CANCELLED'});assert.equal(f.state._playerCombatTask,null);
  const g=fixture();g.bot.attack=entity=>g.bot.emit('entityDead',entity);
  const result=await huntPlayer(g.bot,g.state,{owner:'Owner'},{duration:300});assert.match(result.message,/已死亡/);assert.equal(g.bot.listenerCount('entityDead'),0);
});
