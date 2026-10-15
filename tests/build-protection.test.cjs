const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const {installMovementProtection}=require('../modules/build-protection');
function load(name){
  const file=path.join(__dirname,'../modules',name+'.js'),timers=[],mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:createRequire(file),module:mod,console:{log(){}},setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}});
  return {api:mod.exports,timers};
}
function fixture(){
  const bot=new EventEmitter(),actions=[],sword={name:'diamond_sword',type:1};
  Object.assign(bot,{entity:{position:new Vec3(0,64,0)},health:20,inventory:{items:()=>[sword]},heldItem:sword,players:{},entities:{enemy:{id:2,name:'enderman',isValid:true,position:new Vec3(2,64,0)}},pathfinder:{goal:{},setGoal:g=>actions.push(['goal',g])},setControlState:(...args)=>actions.push(['control',...args]),lookAt(){},attack:()=>actions.push(['attack']),chat:()=>actions.push(['chat']),clearControlStates(){},stopDigging(){},blockAt:()=>({name:'water'})});
  return {bot,actions,state:{mode:'building',_buildTask:{},currentTask:'建造'}};
}
test('health events, hostile scans and direct combat entry never replace an active build',()=>{
  for(const scope of [{mode:'building'},{mode:'idle',_buildTask:{}},{mode:'idle',_buildPanelTask:{}}]){
    const f=fixture();f.state=scope;const {api,timers}=load('combat');api.initCombat(f.bot,f.state,{owner:'Owner'});
    f.bot.emit('health');timers[0]();api.startCombat(f.bot,f.state,f.bot.entities.enemy);
    assert.deepEqual(f.actions,[]);assert.equal(f.state.mode,scope.mode);
    f.state.mode='idle';delete f.state._buildTask;delete f.state._buildPanelTask;
    f.bot.health--;f.bot.emit('health');assert.equal(f.state.mode,'combat');assert(f.actions.some(a=>a[0]==='attack'));
  }
});
test('stuck recovery, swimming rescue and wandering cannot issue movements during construction',()=>{
  const f=fixture(),anti=load('anti-stuck');anti.api.initAntiStuck(f.bot,f.state,{owner:'Owner'});
  for(let i=0;i<12;i++)anti.timers[0]();assert.equal(anti.api.escapeWater(f.bot,f.state),false);assert.deepEqual(f.actions,[]);
  const wander=load('wander');wander.api.startWandering(f.bot,f.state,{autoWander:true,owner:'Owner'});wander.timers[0]();assert.deepEqual(f.actions,[]);
});
test('movement protection is idempotent and owner stop releases it without disabling controls',()=>{
  const f=fixture();installMovementProtection(f.bot,f.state);const wrapped=f.bot.setControlState;installMovementProtection(f.bot,f.state);assert.equal(f.bot.setControlState,wrapped);
  f.bot.setControlState('jump',true);f.bot.pathfinder.setGoal({x:5});assert.deepEqual(f.actions,[]);
  f.bot.setControlState('jump',false);f.bot.pathfinder.setGoal(null);assert.equal(f.actions.length,2);
  require('../modules/task-control').stopCurrentTask(f.bot,f.state);
  // The build token stays until its promise unwinds, so controls are still protected briefly.
  delete f.state._buildTask;f.actions.length=0;f.bot.setControlState('forward',true);f.bot.pathfinder.setGoal({x:5});assert.equal(f.actions.length,2);assert.equal(f.state.mode,'idle');
});
test('other players cannot stop construction, while the owner can',()=>{
  const f=fixture(),chat=require('../modules/chat');
  chat.handleChat('Other','!stop',f.bot,f.state,{owner:'Owner'});assert.equal(f.state.mode,'building');assert.deepEqual(f.actions,[]);
  chat.handleChat('Owner','!stop',f.bot,f.state,{owner:'Owner'});assert.equal(f.state.mode,'idle');assert.equal(f.state._commandEpoch,1);
});
