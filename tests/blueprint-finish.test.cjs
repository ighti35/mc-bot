const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),Chat=require('prismarine-chat')('1.21.11');
const {finishBlueprint,portalGroups}=require('../modules/blueprint-finish');
const {executeBlueprint}=require('../modules/blueprint-build');
function fixture(){
  const bot=new EventEmitter(),state={mode:'building',_buildTask:{}},world=new Map(),commands=[];
  bot._client={state:'play'};bot.pathfinder={setGoal(){}};bot.clearControlStates=()=>{};
  const reply=(key,args=[])=>bot.emit('message',new Chat({translate:key,with:args}),'system');
  bot.chat=text=>{
    commands.push(text);
    if(text.startsWith('/forceload query'))reply('commands.forceload.query.failure');
    else if(text.startsWith('/forceload add'))reply('commands.forceload.added.single');
    else if(text.startsWith('/forceload remove'))reply('commands.forceload.removed.single');
    else if(text.startsWith('/execute if block')){const [,x,y,z,block]=text.match(/^\/execute if block (-?\d+) (-?\d+) (-?\d+) (\S+)$/),actual=world.get(`${x},${y},${z}`)||'minecraft:air';reply((actual===block||!block.includes('[')&&actual.split('[')[0]===block)?'commands.execute.conditional.pass':'commands.execute.conditional.fail');}
    else if(text.startsWith('/setblock')){const [,x,y,z,block,mode]=text.match(/^\/setblock (-?\d+) (-?\d+) (-?\d+) (\S+) (\S+)$/);assert.equal(mode,'strict');world.set(`${x},${y},${z}`,block);reply('commands.setblock.success');}
    else if(text.startsWith('/fill')){const parts=text.split(' ');world.set(parts.slice(1,4).join(','),parts[7]);reply('commands.fill.success',['1']);}
  };
  return {bot,state,world,commands};
}
test('stairs retain exact facing, half and corner shape; decorative portal windows restore last without fire',async()=>{
  const f=fixture(),stairs={x:0,y:0,z:0,name:'minecraft:oak_stairs',setblock:'minecraft:oak_stairs[facing=east,half=top,shape=inner_left,waterlogged=false]'},portal={x:1,y:0,z:0,name:'minecraft:nether_portal',setblock:'minecraft:nether_portal[axis=z]'};
  const s={blocks:[stairs,portal]};assert.equal(portalGroups(s)[0].valid,false);
  f.world.set('0,64,0','minecraft:oak_stairs[facing=east,half=top,shape=straight,waterlogged=false]');
  const result=await finishBlueprint(s,{x:0,y:64,z:0},f.bot,f.state,{woodOnly:true});
  assert.equal(result.stairsRepaired,1);assert.equal(result.portalCellsRestored,1);assert.equal(result.portalCellsVerified,1);
  assert.equal(f.world.get('0,64,0'),stairs.setblock);assert.equal(f.world.get('1,64,0'),portal.setblock);
  const writes=f.commands.filter(c=>c.startsWith('/setblock'));assert(writes[0].includes('oak_stairs'));assert(writes[1].includes('nether_portal'));assert(!f.commands.some(c=>/minecraft:fire| air(?: |$)/.test(c)));
  assert.equal((await finishBlueprint(s,{x:0,y:64,z:0},f.bot,f.state,{woodOnly:true})).stairsRepaired,0);
});
test('portal cells are deferred until supporting structure is placed and count only after verification',async()=>{
  const f=fixture(),s={name:'tiny',size:{x:2,y:1,z:1},blocks:[{x:0,y:0,z:0,name:'minecraft:nether_portal',setblock:'minecraft:nether_portal[axis=x]'},{x:1,y:0,z:0,name:'minecraft:stone'}]};
  const result=await executeBlueprint(s,{x:0,y:64,z:0},f.bot,f.state,f.state._buildTask);
  assert.equal(result.done,2);const writes=f.commands.filter(c=>c.startsWith('/fill')||c.startsWith('/setblock'));
  assert(writes[0].includes('minecraft:stone'));assert(writes.at(-1).includes('nether_portal'));
});
test('a cancelled restoration releases owned chunks and cannot claim a repaired window',async()=>{
  const f=fixture(),original=f.bot.chat;let cancelled=false;
  f.bot.chat=c=>{original(c);if(c.startsWith('/forceload add'))cancelled=true;};
  await assert.rejects(finishBlueprint({blocks:[{x:0,y:0,z:0,name:'minecraft:nether_portal',setblock:'minecraft:nether_portal[axis=x]'}]},{x:0,y:64,z:0},f.bot,f.state,{assertActive(){if(cancelled)throw Object.assign(new Error('stopped'),{code:'TASK_CANCELLED'});}}),{code:'TASK_CANCELLED'});
  assert(f.commands.includes('/forceload remove 0 0'));assert(!f.commands.some(c=>c.startsWith('/setblock')));
});
