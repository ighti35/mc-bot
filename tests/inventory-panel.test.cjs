const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { Vec3 } = require('vec3');
const { attachInventoryHooks, inventorySnapshot, performInventoryAction, fingerprint, startInventoryPanel } = require('../modules/inventory-panel');
function fixture() {
  const definition = {name:'dirt',id:1,stackSize:64,displayName:'Dirt'};
  const slots = Array(46).fill(null);
  slots[9] = {name:'dirt',type:1,metadata:0,count:12,stackSize:64,nbt:{custom:'keep'},enchants:[{name:'test',lvl:2}]};
  const bot = { username:'Claude_Bot', _client:Object.assign(new EventEmitter(),{state:'play'}), entity:{position:new Vec3(0,64,0)}, players:{Owner:{entity:{position:new Vec3(1,64,0)}}}, health:20,food:20,
    registry:{itemsByName:{dirt:definition},itemsArray:[definition]},inventory:{slots,items:()=>slots.filter(Boolean)},pathfinder:{setGoal(){}},clearControlStates(){},stopDigging(){},lookAt:async()=>{},
    transfer:async options=>{bot.lastTransfer=options;slots[options.sourceStart].count-=options.count;},
    chat:command=>{bot.lastCommand=command;slots[10]={name:'dirt',type:1,metadata:0,count:Number(command.split(' ').at(-1)),stackSize:64};} };
  const state={mode:'idle',_commandEpoch:0}; const config={owner:'Owner',username:'Claude_Bot',port:52591,aiApiKey:'secret'};
  attachInventoryHooks(bot);
  return {bot,state,config};
}
test('snapshot exposes slots and enchants without configuration secrets or raw NBT',()=>{
  const ctx=fixture(); const result=inventorySnapshot(ctx);
  assert.equal(result.slots.length,41); assert.equal(result.usedSlots,1);
  assert.equal(result.slots.find(s=>s.slot===9).item.enchants[0].level,2);
  assert.ok(!JSON.stringify(result).includes('secret')); assert.equal(result.slots.find(s=>s.slot===9).item.nbt,undefined);
});
test('protocol command tree grants give permission and confirmed additions use canonical ID',async()=>{
  const ctx=fixture(); ctx.bot._client.emit('declare_commands',{nodes:[{extraNodeData:{name:'give'}}]});
  await performInventoryAction(()=>ctx,{action:'add',item:'泥土',count:3});
  assert.equal(ctx.bot.lastCommand,'/give Claude_Bot minecraft:dirt 3'); assert.equal(ctx.state.mode,'idle');
});
test('addition requires OP and validates item/count before sending a command',async()=>{
  const ctx=fixture(); await assert.rejects(performInventoryAction(()=>ctx,{action:'add',item:'dirt',count:1}),{status:403});
  ctx.bot._inventoryCanGive=true;
  await assert.rejects(performInventoryAction(()=>ctx,{action:'add',item:'dirt\n/op intruder',count:1}),{status:400});
  await assert.rejects(performInventoryAction(()=>ctx,{action:'add',item:'dirt',count:65}),{status:400});
  assert.equal(ctx.bot.lastCommand,undefined);
});
test('full inventory rejects addition before issuing give',async()=>{
  const ctx=fixture();ctx.bot._inventoryCanGive=true;
  for(let i=9;i<=44;i++)ctx.bot.inventory.slots[i]={name:'dirt',type:1,metadata:0,count:64,stackSize:64};
  await assert.rejects(performInventoryAction(()=>ctx,{action:'add',item:'dirt',count:1}),{status:409});
  assert.equal(ctx.bot.lastCommand,undefined);
});
test('take transfers only selected stack and preserves its custom data',async()=>{
  const ctx=fixture();const stack=ctx.bot.inventory.slots[9];
  await performInventoryAction(()=>ctx,{action:'take',slot:9,count:4,fingerprint:fingerprint(stack)});
  assert.equal(stack.count,8);assert.equal(stack.nbt.custom,'keep');
  assert.equal(ctx.bot.lastTransfer.sourceStart,9);assert.equal(ctx.bot.lastTransfer.sourceEnd,10);assert.equal(ctx.bot.lastTransfer.destStart,-999);
});
test('stale slots, busy tasks, offline and absent owner do not transfer',async()=>{
  const ctx=fixture();const body={action:'take',slot:9,count:1,fingerprint:'stale'};
  await assert.rejects(performInventoryAction(()=>ctx,body),{status:409});
  body.fingerprint=fingerprint(ctx.bot.inventory.slots[9]);ctx.state._miningTask={};
  await assert.rejects(performInventoryAction(()=>ctx,body),{status:409});ctx.state._miningTask=null;
  ctx.bot.players={};await assert.rejects(performInventoryAction(()=>ctx,body),{status:409});
  ctx.bot._client.state='disconnected';await assert.rejects(performInventoryAction(()=>ctx,body),{status:409});assert.equal(ctx.bot.lastTransfer,undefined);
});
test('HTTP panel serves local assets and requires matching token/origin for mutation',async t=>{
  const ctx=fixture();const server=startInventoryPanel(()=>ctx,{port:0});await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const page=await (await fetch(base)).text();const token=page.match(/name="panel-token" content="([a-f0-9]+)"/)[1];
  assert.equal((await fetch(base+'/app.js')).status,200);assert.equal((await fetch(base+'/style.css')).status,200);
  const state=await(await fetch(base+'/api/state')).json();assert.equal(state.connected,true);
  const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'stop'})};
  assert.equal((await fetch(base+'/api/action',options)).status,403);
  options.headers['X-Panel-Token']=token;options.headers.Origin='http://other.example';
  assert.equal((await fetch(base+'/api/action',options)).status,403);
  assert.equal(ctx.state._commandEpoch,0);options.headers.Origin=base;
  assert.equal((await fetch(base+'/api/action',options)).status,200);assert.equal(ctx.state._commandEpoch,1);
});
