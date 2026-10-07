const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
function fixture(mode='survival'){
  const file=path.join(__dirname,'../modules/combat.js'),timers=[],mod={exports:{}},clock={now:1},actions=[];
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:createRequire(file),module:mod,console:{log(){}},Date:{now:()=>clock.now},setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}});
  const bot=new EventEmitter(),sword={name:'diamond_sword',type:1},enemy={id:2,name:'zombie',isValid:true,position:new Vec3(8,64,0)};
  Object.assign(bot,{entity:{position:new Vec3(0,64,0)},game:{gameMode:mode},health:20,inventory:{items:()=>[sword]},heldItem:sword,entities:{enemy},pathfinder:{setGoal:g=>actions.push(['goal',g])},clearControlStates:()=>actions.push(['clear']),lookAt(){},attack(){},chat:m=>actions.push(['chat',m])});
  const state={mode:'idle'};mod.exports.initCombat(bot,state,{owner:'Owner'});return {bot,state,enemy,timers,clock,actions,api:mod.exports};
}
test('creative and spectator never automatically chase nearby monsters or react to health events',()=>{
  for(const mode of ['creative','spectator']){const f=fixture(mode);f.timers[0]();f.bot.health=18;f.bot.emit('health');assert.equal(f.state.mode,'idle');assert.deepEqual(f.actions,[]);f.api.startCombat(f.bot,f.state,f.enemy);assert.equal(f.state.mode,'combat','explicit attacks remain available');}
});
test('healing and hunger-only health notifications do not begin combat',()=>{
  const f=fixture();f.bot.emit('health');f.bot.health=22;f.bot.emit('health');assert.equal(f.state.mode,'idle');f.bot.health=20;f.bot.emit('health');assert.equal(f.state.mode,'combat');
});
test('unreachable automatic target releases movement, stays on cooldown, and does not spam chat',()=>{
  const f=fixture();f.timers[0]();assert.equal(f.state.mode,'combat');f.clock.now=26001;f.timers[1]();assert.equal(f.state.mode,'idle');assert(f.actions.some(a=>a[0]==='goal'&&a[1]===null));assert(f.actions.some(a=>a[0]==='clear'));assert(!f.actions.some(a=>a[0]==='chat'));f.timers[0]();assert.equal(f.state.mode,'idle');f.clock.now+=120001;f.timers[0]();assert.equal(f.state.mode,'combat');
});
