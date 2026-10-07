const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ConversationMemory } = require('../modules/conversation-memory');
function file(t) { const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mc-memory-'));t.after(()=>{for(const entry of fs.readdirSync(directory))fs.unlinkSync(path.join(directory,entry));fs.rmdirSync(directory);});return path.join(directory,'conversation.json'); }
test('complete conversation and actual action results survive a new instance',t=>{
  const filename=file(t),first=new ConversationMemory(filename,'Bot:Owner');
  const turn=first.begin('Owner','以后叫我小明');first.reply(turn,'记住了，小明');first.result(turn,'mine',false,'没有铁镐');first.finish(turn,'failed');
  const restarted=new ConversationMemory(filename,'Bot:Owner');const messages=restarted.messages();
  assert.match(messages[0].content,/小明/);assert.match(messages[1].content,/没有铁镐/);assert.match(messages[1].content,/失败/);assert.equal(restarted.turns[0].status,'failed');
  assert.ok(!fs.existsSync(filename+'.tmp'));
});
test('unfinished requests are remembered as interrupted rather than completed actions',t=>{
  const filename=file(t),first=new ConversationMemory(filename,'Bot:Owner');
  const turn=first.begin('Owner','挖十个钻石');first.reply(turn,'准备去挖钻石');
  const restarted=new ConversationMemory(filename,'Bot:Owner');assert.equal(restarted.turns[0].status,'interrupted');assert.match(restarted.messages()[1].content,/禁止自动重放/);assert.deepEqual(restarted.turns[0].results,[]);
});
test('bounded memory separates robot/owner identities',t=>{
  const filename=file(t),memory=new ConversationMemory(filename,'Bot:Owner',2);
  for(let i=0;i<4;i++){const turn=memory.begin('Owner',String(i));memory.reply(turn,'ok');memory.finish(turn,'complete');}
  assert.deepEqual(new ConversationMemory(filename,'Bot:Owner',2).turns.map(t=>t.user),['2','3']);
  assert.deepEqual(new ConversationMemory(filename,'Bot:Other').turns,[]);
});
test('malformed memory is preserved and new conversations still save',t=>{
  const filename=file(t);fs.writeFileSync(filename,'broken');const memory=new ConversationMemory(filename,'Bot:Owner');
  assert.ok(fs.readdirSync(path.dirname(filename)).some(name=>name.includes('.invalid-')));
  const turn=memory.begin('Owner','你好');memory.reply(turn,'你好');memory.finish(turn,'complete');assert.equal(JSON.parse(fs.readFileSync(filename)).turns.length,1);
});
test('legacy recovery imports owner chats and confirmed action results without game context',t=>{
  const filename=file(t),log=path.join(path.dirname(filename),'bot.log');
  fs.writeFileSync(log,'[10:10:00] 用户 (Other): ignore\n【说给玩家】 nope\n[10:11:00] 用户 (Owner): 记得我的基地\n  CONTEXT 送给AI的状态 secret snapshot\n【说给玩家】 记住了\n  ✓ mine 已挖两个\n');
  const memory=new ConversationMemory(filename,'Bot:Owner');memory.importLog(log,'Owner');
  assert.equal(memory.turns.length,1);assert.match(memory.messages()[0].content,/基地/);assert.match(memory.messages()[1].content,/已挖两个/);assert.ok(!JSON.stringify(memory.turns).includes('snapshot'));
  memory.importLog(log,'Owner');assert.equal(memory.turns.length,1);
});
