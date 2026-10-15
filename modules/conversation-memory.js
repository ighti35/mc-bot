const fs = require('fs');
const path = require('path');

class ConversationMemory {
  constructor(filename, scope, limit = 24) {
    this.filename = filename; this.scope = scope; this.limit = limit; this.turns = [];
    if (fs.existsSync(filename)) {
      try {
        const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (saved.version !== 1 || !Array.isArray(saved.turns)) throw new Error('记忆文件格式不正确');
        if (saved.scope === scope) {
          this.turns = saved.turns.filter(turn => typeof turn.user === 'string' && typeof turn.username === 'string').slice(-limit);
          for (const turn of this.turns) {
            if (['pending', 'responded'].includes(turn.status)) turn.status = 'interrupted';
            if (!Array.isArray(turn.results)) turn.results = [];
          }
        }
      } catch (error) {
        console.error('[Memory] 无法读取旧记忆:', error.message);
        // Preserve damaged files before accepting new conversations.
        try { fs.copyFileSync(filename, `${filename}.invalid-${Date.now()}`); } catch (_) {}
      }
    }
  }
  save() {
    try {
      fs.mkdirSync(path.dirname(this.filename), { recursive: true });
      const temporary = `${this.filename}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, scope: this.scope, turns: this.turns }, null, 2), 'utf8');
      fs.renameSync(temporary, this.filename);
    } catch (error) { console.error('[Memory] 保存失败:', error.message); }
  }
  messages() {
    const pairs = this.turns.map(turn => [
      {role:'user',content:`[Player ${turn.username}] ${turn.user}`},
      {role:'assistant',content:`${turn.assistant || '上次未获得回复。'}\n[历史执行记录，禁止自动重放] 状态=${turn.status}; ${turn.results.map(result => `${result.tool}: ${result.success ? '成功' : '失败'} ${result.message}`).join('; ') || '无已确认执行结果'}`},
    ]);
    let length = 0; const recent = [];
    for (let index = pairs.length - 1; index >= 0; index--) {
      const size = pairs[index].reduce((sum, message) => sum + message.content.length, 0);
      if (recent.length && length + size > 60000) break;
      recent.unshift(pairs[index]); length += size;
    }
    return recent.flat();
  }
  importLog(filename, owner) {
    if (this.turns.length || fs.existsSync(this.filename) || !fs.existsSync(filename)) return;
    // Recover only explicit chat/action lines, never API configuration or game snapshots.
    const descriptor = fs.openSync(filename, 'r');
    let text;
    try {
      const size = fs.fstatSync(descriptor).size;
      const buffer = Buffer.alloc(Math.min(size, 1024 * 1024));
      fs.readSync(descriptor, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      text = buffer.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
    } finally { fs.closeSync(descriptor); }
    const headers = [...text.matchAll(/^\[\d{2}:\d{2}:\d{2}\] 用户 \(([^\n)]+)\):\s*(.*)$/gm)];
    for (let index = 0; index < headers.length; index++) {
      const header = headers[index]; if (header[1] !== owner) continue;
      const block = text.slice(header.index + header[0].length, headers[index + 1]?.index ?? text.length);
      const reply = block.match(/【说给玩家】\s*(.*)/)?.[1];
      if (!reply || !header[2].trim()) continue;
      const results = [...block.matchAll(/^\s*[✓✗] ([a-z_]+)\s*(.*)$/gm)].map(match => ({tool:match[1],success:match[0].includes('✓'),message:match[2].slice(0,2000)}));
      this.turns.push({username:owner,user:header[2].slice(0,4000),assistant:reply.slice(0,12000),results,status:'legacy',time:Date.now()});
    }
    this.turns = this.turns.slice(-this.limit);
    if (this.turns.length) this.save();
  }
  begin(username, message) {
    const turn = {username, user:message.slice(0, 4000), assistant:'', results:[], status:'pending', time:Date.now()};
    this.turns.push(turn); this.turns = this.turns.slice(-this.limit); this.save(); return turn;
  }
  reply(turn, response) { turn.assistant = response.slice(0, 12000); turn.status = 'responded'; this.save(); }
  result(turn, tool, success, message) {
    turn.results.push({tool:String(tool).slice(0, 80),success:Boolean(success),message:String(message || '').slice(0, 2000)});
    this.save();
  }
  finish(turn, status) { turn.status = status; this.save(); }
}
module.exports = { ConversationMemory };
