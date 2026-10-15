const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const permissions=require('../modules/command-permissions');
const {enabled,executeWithFallback,runCommand}=require('../modules/command-assist');
const {stopCurrentTask}=require('../modules/task-control');
function fixture(){
  const bot=new EventEmitter(),state={mode:'idle'},config={owner:'Owner',autoCommandFallback:true},packets=[];
  bot._client={state:'play',write:(name,packet)=>packets.push({name,packet})};
  bot.chat=message=>message.startsWith('/')?bot._client.write('chat_command',{command:message.slice(1)}):bot._client.write('chat_message',{message});
  bot.pathfinder={setGoal(){}};bot.clearControlStates=()=>{};bot.stopDigging=()=>{};
  permissions.installCommandGuard(bot,state,config);return {bot,state,config,packets};
}
test('default deny blocks slash chat and direct command packets but keeps ordinary chat and respawn',()=>{
  const f=fixture();assert.equal(enabled(f.config),false);
  f.bot.chat('/give @s diamond 1');f.bot._client.write('chat_command',{command:'tp @s Owner'});
  f.bot.chat('hello');f.bot._client.write('client_command',{actionId:0});
  assert.deepEqual(f.packets.map(packet=>packet.name),['chat_message','client_command']);
});
test('actual creative mode enables commands and fallback, and switching away immediately closes the gate',()=>{
  const f=fixture();
  for(const mode of ['creative',1]){
    f.bot.game={gameMode:mode};
    assert(enabled(f.config,'',f.state,f.bot));
    assert.doesNotThrow(()=>permissions.requireAllowed(f.bot,f.state));
    f.bot.chat('/time query daytime');f.bot._client.write('chat_command',{command:'time query daytime'});
    assert.match(permissions.request('Owner','!commands status',f.state,f.config,f.bot),/创造模式/);
  }
  for(const mode of ['survival',0,'adventure',2,'spectator',3]){
    f.bot.game.gameMode=mode;
    assert(!enabled(f.config,'',f.state,f.bot));
    assert.throws(()=>permissions.requireAllowed(f.bot,f.state),{code:'COMMAND_NOT_AUTHORIZED'});
    f.bot.chat('/time query daytime');
  }
  assert.equal(f.packets.length,4);
});
test('explicit task prohibition blocks creative commands at both chat and packet level until the task finishes',async()=>{
  const f=fixture();f.bot.game={gameMode:'creative'};
  await permissions.withAuthorization('Owner','合成木斧，不要用指令',f.bot,f.state,f.config,async()=>{
    assert(!enabled(f.config,'',f.state,f.bot));
    f.bot.chat('/give @s wooden_axe');f.bot._client.write('chat_command',{command:'give @s wooden_axe'});
    assert.throws(()=>permissions.requireAllowed(f.bot,f.state),{code:'COMMAND_NOT_AUTHORIZED'});
  });
  assert.equal(f.packets.length,0);assert(enabled(f.config,'',f.state,f.bot));
  permissions.request('Owner','!commands off',f.state,f.config,f.bot);
  assert(!enabled(f.config,'',f.state,f.bot));f.bot.chat('/time query daytime');
  assert.equal(f.packets.length,0);
  permissions.request('Owner','!commands on',f.state,f.config,f.bot);
  assert(enabled(f.config,'',f.state,f.bot));
});
test('an owner inline authorization is scoped to one awaited task and expires on completion or failure',async()=>{
  const f=fixture();
  await permissions.withAuthorization('Owner','这次可以用指令，传送过来',f.bot,f.state,f.config,async()=>{assert(enabled(f.config,'',f.state));f.bot.chat('/tp @s Owner');});
  f.bot.chat('/give @s dirt 1');assert.equal(f.packets.length,1);
  await assert.rejects(permissions.withAuthorization('Owner','这次可以用指令',f.bot,f.state,f.config,async()=>{throw new Error('failed');}));
  assert.equal(permissions.active(f.state),false);
});
test('standalone authorization permits only the next owner task and cannot be stolen by another player',async()=>{
  const f=fixture();assert.match(permissions.request('Owner','可以用指令',f.state,f.config),/下一次/);
  await permissions.withAuthorization('Other','用指令',f.bot,f.state,f.config,async()=>f.bot.chat('/give @s dirt 1'));
  assert.equal(f.packets.length,0);assert(permissions.pending(f.state,'Owner'));
  await permissions.withAuthorization('Owner','!come',f.bot,f.state,f.config,async()=>f.bot.chat('/tp @s Owner'));
  await permissions.withAuthorization('Owner','!come',f.bot,f.state,f.config,async()=>f.bot.chat('/tp @s Owner'));
  assert.equal(f.packets.length,1);assert(!permissions.pending(f.state,'Owner'));
});

test('natural grant variants work and an explicitly normal task clears a pending grant',()=>{
  for(const message of ['我允许你使用指令','现在可以用指令了']){const f=fixture();assert(permissions.request('Owner',message,f.state,f.config));assert(permissions.pending(f.state,'Owner'));permissions.begin('Owner','合成木斧，不要用指令',f.bot,f.state,f.config);assert(!permissions.pending(f.state,'Owner'));}
  const f=fixture();permissions.request('Owner','可以用指令',f.state,f.config);assert(permissions.request('Owner','把指令权限禁用',f.state,f.config));assert(!permissions.pending(f.state,'Owner'));
});
test('questions, conditional statements, explicit prohibitions and restart do not authorize commands',()=>{
  for(const message of ['能不能用指令？','只有我说能用指令的时候再用','不要用指令','你为什么可以用指令','如果可以用指令就好了'])assert.equal(permissions.allows(message),false);
  const f=fixture();permissions.request('Owner','可以用指令',f.state,f.config);
  const replacement=new EventEmitter();replacement.chat=()=>{};replacement._client={write(){}};
  permissions.installCommandGuard(replacement,f.state,f.config);assert(!permissions.pending(f.state,'Owner'));
});
test('!stop revokes active and pending authorization, including subsequent low-level packets',()=>{
  const f=fixture(),release=permissions.begin('Owner','可以用指令',f.bot,f.state,f.config);
  stopCurrentTask(f.bot,f.state);f.bot.chat('/give @s dirt 1');release();assert.equal(f.packets.length,0);
});
test('without authorization, normal crafting failure never generates an output and cmd cannot bypass the gate',async()=>{
  const f=fixture();f.bot.registry={itemsByName:{crafting_table:{name:'crafting_table'}}};f.bot.inventory={items:()=>[]};
  await assert.rejects(executeWithFallback({tool:'craft',args:{item:'crafting_table'}},f.bot,f.state,f.config,async()=>{throw new Error('缺少木头');}),/缺少木头/);
  await assert.rejects(runCommand(f.bot,f.state,'/give @s crafting_table 1'),{code:'COMMAND_NOT_AUTHORIZED'});assert.equal(f.packets.length,0);
});
