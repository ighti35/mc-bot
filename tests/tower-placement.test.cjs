const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {Vec3}=require('vec3');
const {installTowerPlacement}=require('../modules/tower-placement');

function fixture(){
  const bot=new EventEmitter(),state={_journeyTask:{},_commandEpoch:1},placements=[],looks=[];
  let confirm;
  const acknowledgement=new Promise(resolve=>{confirm=resolve;});
  Object.assign(bot,{health:20,entity:{position:new Vec3(.5,1.42,.5)},pathfinder:{movements:{allow1by1towers:true}},
    blockAt:()=>({name:'air',boundingBox:'empty'}),lookAt:async(point,force)=>looks.push({point,force}),
    placeBlock:async(reference,face)=>placements.push({normal:true,reference,face}),
    _placeBlockWithOptions:async(reference,face,options)=>{placements.push({reference,face,options});await acknowledgement;}});
  const reference={name:'stone',position:new Vec3(0,0,0)},face=new Vec3(0,1,0);
  installTowerPlacement(bot,state);
  return {bot,state,reference,face,placements,looks,confirm};
}

test('tower waits until feet clear the new cube, then places in the same jump and awaits acknowledgement',async()=>{
  const f=fixture();let completed=false;
  const task=f.bot.placeBlock(f.reference,f.face).then(()=>{completed=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.looks[0].force,true);
  f.bot.entity.position.y=1.9;f.bot.emit('physicsTick');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.placements.length,0,'must not send a colliding placement on the first jump tick');
  f.bot.entity.position.y=2.16;f.bot.emit('physicsTick');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.placements.length,1);assert.equal(f.placements[0].options.forceLook,true);assert.equal(completed,false);
  f.confirm();await task;assert.equal(completed,true);assert.equal(f.bot.listenerCount('physicsTick'),0);
});

test('stop or leaving the column aborts before a block is sent and clears the physics listener',async()=>{
  const f=fixture();const task=f.bot.placeBlock(f.reference,f.face);
  await new Promise(resolve=>setImmediate(resolve));f.state._commandEpoch++;f.bot.emit('physicsTick');
  await assert.rejects(task,{code:'TASK_CANCELLED'});assert.equal(f.placements.length,0);assert.equal(f.bot.listenerCount('physicsTick'),0);
  const g=fixture();const offColumn=g.bot.placeBlock(g.reference,g.face);
  await new Promise(resolve=>setImmediate(resolve));g.bot.entity.position.x=1.5;g.bot.emit('physicsTick');
  await assert.rejects(offColumn,/离开了支撑柱/);assert.equal(g.placements.length,0);
});

test('ordinary block placement is unchanged and repeated installation is harmless',async()=>{
  const f=fixture();installTowerPlacement(f.bot,f.state);
  f.state._journeyTask=null;await f.bot.placeBlock(f.reference,f.face);
  assert.equal(f.placements[0].normal,true);assert.equal(f.looks.length,0);
});

test('a low ceiling prevents tower placement before jumping or using an item',async()=>{
  const f=fixture();f.bot.blockAt=()=>({name:'stone',boundingBox:'block'});
  await assert.rejects(f.bot.placeBlock(f.reference,f.face),/空间不足/);assert.equal(f.placements.length,0);assert.equal(f.looks.length,0);
});
