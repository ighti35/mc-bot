const fs = require('node:fs');
const net = require('node:net');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
async function main() {
  if (process.argv[3] === 'minecraft') {
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: config.host, port: Number(config.port) });
      socket.setTimeout(5000);
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => reject(new Error('无法连接游戏。请确认世界已开放局域网，并填写游戏显示的实际端口。')));
      socket.once('timeout', () => { socket.destroy(); reject(new Error('游戏连接超时，请检查地址、端口和防火墙。')); });
    });
    console.log('游戏端口可连接。此检查验证网络连接，不代表登录权限或游戏版本一定兼容。');
  } else {
    let response;
    try {
      response = await fetch(config.aiApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.aiApiKey}` },
        body: JSON.stringify({ model: config.aiModel, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 8 }),
        signal: AbortSignal.timeout(25000),
      });
    } catch { throw new Error('API 网络连接失败或超时，请检查 API 地址与网络。'); }
    if (!response.ok) {
      const reason = response.status === 401 ? 'API Key 无效或已过期' : response.status === 402 ? '余额不足' : response.status === 429 ? '请求限流或额度不足' : '请检查模型、完整请求地址和账户状态';
      throw new Error(`API 请求失败（HTTP ${response.status}）：${reason}。`);
    }
    const data = await response.json();
    if (!Array.isArray(data.choices) || !data.choices.length) throw new Error('API 返回格式与 Chat Completions 不兼容。');
    console.log('API 测试成功，可以使用聊天模型。');
  }
}
main().catch(error => { console.log(error.message); process.exitCode = 1; });
