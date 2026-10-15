const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {EventEmitter}=require('node:events'),{Vec3}=require('vec3'),Chat=require('prismarine-chat')('1.21.11');
const loader=require('../modules/schematic-loader');
const {startBuilder}=require('../modules/builder');
const {executeBlueprint,blockRuns,planChunks}=require('../modules/blueprint-build');
const {stopCurrentTask}=require('../modules/task-control');
function fixture(){
  const bot=new EventEmitter(),state={mode:'building',_buildTask:{}},commands=[];
  Object.assign(bot,{registry:require('minecraft-data')('1.21.11'),game:{gameMode:'creative'},entity:{position:new Vec3(0,64,0)},_client:{state:'play'},pathfinder:{setGoal(){}},clearControlStates(){},stopDigging(){}});
  const reply=(key,withArgs=[])=>bot.emit('message',new Chat({translate:key,with:withArgs}),'system');
  bot.chat=command=>{commands.push(command);if(command.startsWith('/forceload query'))reply('commands.forceload.query.failure');else if(command.startsWith('/forceload add'))reply('commands.forceload.added.single');else if(command.startsWith('/forceload remove'))reply('commands.forceload.removed.single');else if(command.startsWith('/fill'))reply('commands.fill.success',['2']);else if(command.startsWith('/setblock'))reply('commands.setblock.success');};
  return {bot,state,commands,reply};
}
test('every installed schematic file has valid coordinates and supported 1.21.11 states',async()=>{
  for(const file of fs.readdirSync(loader.directory).filter(f=>/\.(json|litematic|schem|schematic)$/.test(f))){
    const s=await loader.loadSchematic(path.basename(file,path.extname(file)),path.extname(file));
    assert.doesNotThrow(()=>loader.validateSchematic(s),file);
  }
});
test('litematic contiguous bits cross long boundaries and preserve signed multi-region positions',()=>{
  const palette=Array.from({length:5},(_,i)=>({Name:i===0?'minecraft:air':'minecraft:stone',Properties:{}})),indexes=Array.from({length:24},(_,i)=>i%5);
  const longs=[0n,0n];indexes.forEach((v,i)=>{const bit=i*3,j=Math.floor(bit/64),shift=bit%64;longs[j]|=BigInt(v)<<BigInt(shift);if(shift+3>64)longs[j+1]|=BigInt(v)>>BigInt(64-shift);});
  const tuples=longs.map(v=>[Number(BigInt.asIntN(32,v>>32n)),Number(BigInt.asIntN(32,v))]);
  const s=loader.decodeLitematic({Regions:{a:{Position:{x:10,y:3,z:2},Size:{x:-24,y:1,z:1},BlockStatePalette:palette,BlockStates:tuples},b:{Position:{x:15,y:4,z:2},Size:{x:1,y:1,z:1},BlockStatePalette:palette,BlockStates:[[0,1]]}}},'synthetic');
  assert.equal(s.totalBlocks,indexes.filter(i=>i!==0).length+1);assert.equal(s.size.x,28);assert.equal(s.size.y,2);
});
test('unknown schematic fails explicitly instead of returning successful action',async()=>{
  const f=fixture();f.state._buildTask=null;
  await assert.rejects(startBuilder(['not-a-real-schematic'],f.bot,f.state),/没有找到/);
  assert.equal(f.state.mode,'idle');assert.equal(f.state._lastBuildResult.success,false);assert.equal(f.commands.length,0);
});
test('builder groups matching states within chunks and waits for server confirmations using keep',async()=>{
  const f=fixture(),s={name:'tiny',size:{x:2,y:1,z:1},blocks:[{x:0,y:0,z:0,name:'minecraft:stone'},{x:1,y:0,z:0,name:'minecraft:stone'}]};
  const result=await executeBlueprint(s,{x:0,y:64,z:0},f.bot,f.state,f.state._buildTask);
  assert.equal(result.done,2);assert.equal(f.commands.filter(c=>c.startsWith('/fill')).length,1);assert(f.commands.includes('/fill 0 64 0 1 64 0 minecraft:stone replace minecraft:air strict'));assert(f.commands.includes('/forceload remove 0 0'));
  assert(!f.commands.some(c=>/ air$|gamemode/.test(c)));
  assert.equal(planChunks(s,{x:15,y:64,z:0}).length,2);
  assert.equal(blockRuns([{x:0,y:0,z:0,block:'stone'},{x:1,y:0,z:0,block:'dirt'}]).length,2);
});
test('occupied positions and partial fills stop without claiming completion, releasing owned tickets',async()=>{
  for(const partial of [false,true]){
    const f=fixture(),original=f.bot.chat;
    f.bot.chat=c=>{if(c.startsWith('/execute if block')){f.commands.push(c);f.reply('commands.execute.conditional.fail');}else if(c.startsWith('/fill')){f.commands.push(c);f.reply(partial?'commands.fill.success':'commands.fill.failed',partial?['1']:[]);}else original(c);};
    const s={name:'tiny',size:{x:2,y:1,z:1},blocks:[{x:0,y:0,z:0,name:'minecraft:stone'},{x:1,y:0,z:0,name:'minecraft:stone'}]};
    await assert.rejects(executeBlueprint(s,{x:0,y:64,z:0},f.bot,f.state,f.state._buildTask),/占用/);
    assert(f.commands.includes('/forceload remove 0 0'));assert.equal(f.state._buildProgress,undefined);
  }
});
test('zero-change and partial retries verify existing intended blocks before counting them',async()=>{
  for(const partial of [false,true]){
    const f=fixture(),original=f.bot.chat;
    f.bot.chat=c=>{if(c.startsWith('/execute if block')){f.commands.push(c);f.reply('commands.execute.conditional.pass');}else if(c.startsWith('/fill')){f.commands.push(c);f.reply(partial?'commands.fill.success':'commands.fill.failed',partial?['1']:[]);}else original(c);};
    const result=await executeBlueprint({name:'tiny',size:{x:2,y:1,z:1},blocks:[{x:0,y:0,z:0,name:'minecraft:stone'},{x:1,y:0,z:0,name:'minecraft:stone'}]},{x:0,y:64,z:0},f.bot,f.state,f.state._buildTask);
    assert.equal(result.done,2);assert.equal(f.commands.filter(c=>c.startsWith('/execute if block')).length,2);
  }
});
test('terrain cleanup requires a scoped checkpoint grant and stays inside the exact schematic bounds',async()=>{
  const checkpoint=require('../modules/build-checkpoint'),save=checkpoint.save;checkpoint.save=()=>{};
  try{
    const f=fixture(),s={name:'tiny',size:{x:1,y:130,z:1},blocks:[{x:0,y:0,z:0,name:'minecraft:stone'}]};
    f.state._buildCheckpoint={clearTerrain:true,clearedChunks:[],done:0,nextRun:0};
    await executeBlueprint(s,{x:15,y:64,z:15},f.bot,f.state,f.state._buildTask);
    const clears=f.commands.filter(c=>c.endsWith(' air'));
    assert.deepEqual(clears,['/fill 15 64 15 15 127 15 air','/fill 15 128 15 15 191 15 air','/fill 15 192 15 15 193 15 air']);
    assert(f.commands.includes('/setblock 15 64 15 minecraft:stone strict'));
    assert.equal(f.state._buildCheckpoint.completed,true);
  }finally{checkpoint.save=save;}
});
test('stop racing with forceload acknowledgement releases only the owned ticket and places no blocks',async()=>{
  const f=fixture(),original=f.bot.chat;
  f.bot.chat=c=>{if(c.startsWith('/forceload add')){f.commands.push(c);stopCurrentTask(f.bot,f.state);f.reply('commands.forceload.added.single');}else original(c);};
  await assert.rejects(executeBlueprint({name:'tiny',size:{x:1,y:1,z:1},blocks:[{x:0,y:0,z:0,name:'minecraft:stone'}]},{x:0,y:64,z:0},f.bot,f.state,f.state._buildTask),{code:'TASK_CANCELLED'});
  assert(f.commands.includes('/forceload remove 0 0'));assert(!f.commands.some(c=>c.startsWith('/setblock')));
});
test('restart restores only the exact unfinished building, origin and scoped cleanup grant',()=>{
  const checkpoint=require('../modules/build-checkpoint'),os=require('os');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mc-build-checkpoint-')),filename=path.join(dir,'job.json');
  try{
    const bot={username:'Claude_Bot',game:{dimension:'overworld'}},s={name:'tiny',size:{x:1,y:1,z:1},blocks:[{x:0,y:0,z:0,name:'minecraft:stone'}]};
    const job=checkpoint.create(bot,s,{x:-279,y:69,z:-88});Object.assign(job,{done:1,nextRun:1,clearTerrain:true,clearedChunks:['-18,-6']});
    checkpoint.save({_buildCheckpoint:job},filename);
    assert.deepEqual(checkpoint.restore(bot,s,{},filename),job);
    assert.equal(checkpoint.restore({...bot,username:'Other'},s,{},filename),null);
    assert.equal(checkpoint.restore(bot,{...s,blocks:[{x:0,y:0,z:0,name:'minecraft:dirt'}]},{},filename),null);
    job.completed=true;checkpoint.save({_buildCheckpoint:job},filename);assert.equal(checkpoint.restore(bot,s,{},filename),null);
    assert.equal(checkpoint.create(bot,s,{x:0,y:64,z:0}).clearTerrain,undefined);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
