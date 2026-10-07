const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {Vec3}=require('vec3');
const {digConfirmed}=require('../modules/dig-confirmed');
function fixture(){
  const state={},block={name:'deepslate',type:1,position:new Vec3(-2,-58,3)},client=new EventEmitter();
  const bot={registry:{blocksByStateId:{}},health:20,_client:client,stopDigging(){},blockAt:()=>({type:0,name:'air'}),autoEat:{enabled:true,isEating:false,disableAuto(){this.enabled=false;},enableAuto(){this.enabled=true;}},dig:async(b,force)=>{assert.equal(force,true);assert.equal(bot.autoEat.enabled,false);}};
  return {bot,block,state,client};
}
test('local optimistic air does not permit switching blocks before the real server confirmation',async()=>{
  const f=fixture();let completed=false;
  const task=digConfirmed(f.bot,f.block,{state:f.state,confirmationTimeout:300}).then(()=>{completed=true;});
  await new Promise(r=>setImmediate(r));assert.equal(completed,false);assert(f.state._digTask);
  f.client.emit('block_change',{location:f.block.position,type:0});await task;
  assert.equal(completed,true);assert.equal(f.state._digTask,null);assert.equal(f.bot.autoEat.enabled,true);
  assert.equal(f.client.listenerCount('block_change'),0);
});
test('server rejection or missing acknowledgement stops the dig instead of counting speculative air',async()=>{
  const f=fixture();const task=digConfirmed(f.bot,f.block,{state:f.state,confirmationTimeout:30});
  await new Promise(r=>setImmediate(r));f.client.emit('block_change',{location:f.block.position,type:1});
  await assert.rejects(task,/服务器未确认/);assert.equal(f.state._digTask,null);
});
test('packed section updates confirm the exact target even at negative world coordinates',async()=>{
  const f=fixture();const task=digConfirmed(f.bot,f.block,{state:f.state,confirmationTimeout:300});
  await new Promise(r=>setImmediate(r));
  const record=BigInt((14<<8)|(3<<4)|6);
  f.client.emit('multi_block_change',{chunkCoordinates:{x:-1,y:-4,z:0},records:[record]});await task;
});
test('an existing meal finishes before tool selection and cancellation restores automatic eating',async()=>{
  const f=fixture();f.bot.autoEat.isEating=true;let prepared=false,cancelled=false;
  const active=()=>{if(cancelled){const error=new Error('stopped');error.code='TASK_CANCELLED';throw error;}};
  const task=digConfirmed(f.bot,f.block,{state:f.state,assertActive:active,prepare:async()=>{prepared=true;}});
  await new Promise(r=>setTimeout(r,20));assert.equal(prepared,false);cancelled=true;
  await assert.rejects(task,{code:'TASK_CANCELLED'});assert.equal(f.bot.autoEat.enabled,true);assert.equal(f.state._digTask,null);
});
test('ore dig waits for landing and does not cancel before the predicted dig duration',async()=>{
  const f=fixture();f.bot.entity={onGround:false};let cancelled=0,started=false;
  f.bot.stopDigging=()=>cancelled++;
  f.bot.digTime=()=>80;
  f.bot.dig=async()=>{started=true;assert.equal(f.bot.entity.onGround,true);await new Promise(resolve=>setTimeout(resolve,80));f.client.emit('block_change',{location:f.block.position,type:0});};
  setTimeout(()=>{f.bot.entity.onGround=true;},30);
  await digConfirmed(f.bot,f.block,{state:f.state,timeout:25});assert(started);assert.equal(cancelled,0);
});
