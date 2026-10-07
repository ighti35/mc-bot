const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const registry=require('minecraft-data')('1.21.11');
const Chat=require('prismarine-chat')('1.21.11');
const {enabled,runCommand,executeWithFallback,teleportToSurface}=require('../modules/command-assist');
function fixture(){
  const bot=new EventEmitter(),items=[],commands=[],state={mode:'idle'},config={owner:'Owner',autoCommandFallback:true};
  Object.assign(bot,{registry,username:'Claude_Bot',entity:{position:new Vec3(0,64,0)},game:{dimension:'overworld'},_client:{state:'play'},players:{Owner:{entity:{position:new Vec3(10,70,5)}}},inventory:{items:()=>items},pathfinder:{setGoal(){}},clearControlStates(){},chat(command){commands.push(command);}});
  const reply=(key,position='system')=>bot.emit('message',new Chat({translate:key,with:[{text:'Claude_Bot'}]}),position);
  return {bot,state,config,items,commands,reply};
}
test('failed movement automatically teleports and verifies actual position',async()=>{
  const f=fixture();f.bot.chat=command=>{f.commands.push(command);if(command.startsWith('/tp'))setImmediate(()=>{f.bot.entity.position=f.bot.players.Owner.entity.position.clone();f.reply('commands.teleport.success.entity.single');});};
  const result=await executeWithFallback({tool:'come',args:{}},f.bot,f.state,f.config,async()=>{throw new Error('路线均受阻');});
  assert(result.commandFallback);assert(f.commands.includes('/tp @s Owner'));assert.equal(f.state._commandTask,null);assert.equal(f.state.mode,'idle');
});
test('partial acquisition gives only the missing requested quantity and reports command method',async()=>{
  const f=fixture();f.items.push({name:'diamond',count:4});
  f.bot.chat=command=>{f.commands.push(command);if(command.startsWith('/give')){assert.equal(command,'/give @s minecraft:diamond 3');f.items[0].count+=3;f.reply('commands.give.success.single');}};
  const result=await executeWithFallback({tool:'mine',args:{block:'diamond_ore',count:5}},f.bot,f.state,f.config,async()=>{f.items[0].count+=2;throw new Error('目标未加载');},()=>{},{message:'给我挖5个钻石'});
  assert.equal(f.items[0].count,9);assert.equal(result.count,3);assert.match(result.message,/指令/);assert.equal(f.state._lastCommandFallback.tool,'mine');
});
test('a crafting material failure can supply the requested output instead of inventing /craft',async()=>{
  const f=fixture();f.bot.chat=command=>{f.commands.push(command);if(command.startsWith('/give')){f.items.push({name:'crafting_table',count:1});f.reply('commands.give.success.single');}};
  const result=await executeWithFallback({tool:'craft',args:{item:'crafting_table',count:1}},f.bot,f.state,f.config,async()=>{throw new Error('缺少木板');});
  assert(result.commandFallback);assert(f.commands.includes('/give @s minecraft:crafting_table 1'));
});
test('server feedback alone cannot fake a self give inventory result',async()=>{
  const f=fixture();let completed=false;
  const task=runCommand(f.bot,f.state,'/give @s minecraft:dirt 2',{timeout:500}).then(result=>{completed=true;return result;});
  f.reply('commands.give.success.single');await new Promise(resolve=>setImmediate(resolve));assert.equal(completed,false);
  f.items.push({name:'dirt',count:2});assert((await task).verified);assert.equal(f.bot.listenerCount('message'),0);
});
test('player chat cannot spoof a command success and permission errors fail without retry',async()=>{
  const f=fixture();let completed=false;
  const task=runCommand(f.bot,f.state,'/time set day',{timeout:500}).then(result=>{completed=true;return result;});
  f.reply('commands.time.set','chat');await new Promise(resolve=>setImmediate(resolve));assert.equal(completed,false);
  f.reply('commands.time.set');await task;
  const denied=runCommand(f.bot,f.state,'/give @s minecraft:dirt 1',{timeout:500});
  f.reply('commands.generic.permission');await assert.rejects(denied,/服务器拒绝/);
  assert.equal(f.bot.listenerCount('message'),0);assert.equal(f.state._commandTask,null);
});
test('stop, including a changed epoch with a generic error, never triggers fallback',async()=>{
  for(const coded of [true,false]){
    const f=fixture();
    await assert.rejects(executeWithFallback({tool:'come'},f.bot,f.state,f.config,async()=>{f.state._commandEpoch=1;throw Object.assign(new Error('已停止'),coded?{code:'TASK_CANCELLED'}:{});}),{code:'TASK_CANCELLED'});
    assert.equal(f.commands.length,0);
  }
});
test('explicit restrictions and disabled policy preserve ordinary failure without sending commands',async()=>{
  assert.equal(enabled({},'过来，不准传送'),false);assert.equal(enabled({},'不要用指令，挖钻石'),false);
  for(const options of [{config:{autoCommandFallback:false},message:''},{config:{},message:'只用生存方式过来'}]){
    const f=fixture();await assert.rejects(executeWithFallback({tool:'come'},f.bot,f.state,options.config,async()=>{throw new Error('受阻');},()=>{},{message:options.message}),/受阻/);assert.equal(f.commands.length,0);
  }
});
test('busy tasks and tunnel excavation do not become unrelated give commands',async()=>{
  for(const [action,error] of [[{tool:'come'},'已有任务'],[{tool:'mine',args:{block:'diamond_ore',count:5,strategy:'branch'}},'路线受阻']]){
    const f=fixture();await assert.rejects(executeWithFallback(action,f.bot,f.state,f.config,async()=>{throw new Error(error);}));assert.equal(f.commands.length,0);
  }
});
test('cancellation during command feedback wait cleans up and does not retry',async()=>{
  const f=fixture();const task=runCommand(f.bot,f.state,'/tp @s 100 70 100',{timeout:500});f.state._commandEpoch=1;
  await assert.rejects(task,{code:'TASK_CANCELLED'});assert.equal(f.commands.length,1);assert.equal(f.bot.listenerCount('message'),0);
});
test('old locate coordinates cannot be reused as fallback for a failed new locate request',async()=>{
  const f=fixture();f.state._lastLocatedTarget={x:10,y:null,z:10,foundAt:1};
  await assert.rejects(executeWithFallback({tool:'find_village',args:{}},f.bot,f.state,f.config,async()=>{throw new Error('服务器定位失败');}),/定位失败/);assert(!f.commands.some(command=>command.startsWith('/')));
});

test('an already-satisfied position cannot hide a permission denial',async()=>{
  const f=fixture();f.bot.chat=command=>{f.commands.push(command);setImmediate(()=>f.reply('commands.generic.permission'));};
  await assert.rejects(runCommand(f.bot,f.state,'/tp @s 0 64 0'),/服务器拒绝/);
});

test('failed delivery teleports then tosses existing items with their original data',async()=>{
  const f=fixture(),sword={name:'diamond_sword',type:registry.itemsByName.diamond_sword.id,metadata:0,count:1,nbt:{custom:true}};
  f.items.push(sword);f.bot.lookAt=async()=>{};
  f.bot.toss=async(type,metadata,count)=>{assert.equal(type,sword.type);assert.equal(sword.nbt.custom,true);sword.count-=count;};
  f.bot.chat=command=>{f.commands.push(command);if(command.startsWith('/tp')){f.bot.entity.position=f.bot.players.Owner.entity.position.clone();f.reply('commands.teleport.success.entity.single');}};
  const result=await executeWithFallback({tool:'drop',args:{item:'diamond_sword',count:1}},f.bot,f.state,f.config,async()=>{throw new Error('无法靠近玩家');});
  assert(result.commandFallback);assert.equal(sword.count,0);assert(!f.commands.some(command=>command.startsWith('/give')));
});

function distantFixture({alreadyForced=false,neverLoads=false}={}){
  const f=fixture();let attempts=0;
  f.bot.chat=command=>{
    f.commands.push(command);
    if(command.startsWith('/execute positioned')){
      if(++attempts<=2||neverLoads)f.reply('argument.pos.unloaded');
      else{f.bot.entity.position=new Vec3(826.5,81,95.5);f.reply('commands.teleport.success.location.single');}
    }else if(command.startsWith('/forceload query'))f.reply(alreadyForced?'commands.forceload.query.success':'commands.forceload.query.failure');
    else if(command.startsWith('/forceload add'))f.reply('commands.forceload.added.single');
    else if(command.startsWith('/forceload remove'))f.reply('commands.forceload.removed.single');
  };
  return f;
}
test('distant unloaded destination loads one chunk, waits for generation, teleports and releases only its own ticket',async()=>{
  const f=distantFixture();const result=await teleportToSurface(f.bot,f.state,{x:826,z:95},()=>{},{retryDelay:1});
  assert(result.verified);assert.equal(f.bot.entity.position.y,81);
  assert(f.commands.includes('/forceload add 826 95'));assert(f.commands.includes('/forceload remove 826 95'));
  assert.equal(f.commands.filter(command=>command.startsWith('/execute positioned')).length,3);
});
test('existing user force-load tickets are preserved on remote arrival',async()=>{
  const f=distantFixture({alreadyForced:true});await teleportToSurface(f.bot,f.state,{x:826,z:95},()=>{},{retryDelay:1});
  assert(!f.commands.some(command=>/^\/forceload (?:add|remove)/.test(command)));
});
test('failed chunk generation is bounded and cleans up without claiming arrival',async()=>{
  const f=distantFixture({neverLoads:true});
  await assert.rejects(teleportToSurface(f.bot,f.state,{x:826,z:95},()=>{},{loadTimeout:0,retryDelay:1}),{code:'COMMAND_CHUNK_UNLOADED'});
  assert(f.commands.includes('/forceload remove 826 95'));assert.equal(f.bot.entity.position.x,0);
});

test('stop during server acknowledgement releases an added chunk but never teleports onward',async()=>{
  const f=distantFixture(),send=f.bot.chat;
  f.bot.chat=command=>{
    if(command.startsWith('/forceload add')){f.state._commandEpoch=1;f.state.mode='idle';}
    send(command);
  };
  await assert.rejects(teleportToSurface(f.bot,f.state,{x:826,z:95},()=>{if(f.state._commandEpoch)throw Object.assign(new Error('stop'),{code:'TASK_CANCELLED'});},{retryDelay:1}),{code:'TASK_CANCELLED'});
  assert(f.commands.includes('/forceload remove 826 95'));assert.equal(f.commands.filter(command=>command.startsWith('/execute positioned')).length,1);
});
