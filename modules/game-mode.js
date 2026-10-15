const fs = require('fs');
const path = require('path');
const MODES = ['survival', 'creative', 'adventure', 'spectator'];
const LABELS = { survival: '生存', creative: '创造', adventure: '冒险', spectator: '旁观' };
const ALIASES = { survive: 'survival', 生存: 'survival', 创造: 'creative', 冒险: 'adventure', 旁观: 'spectator', 观察: 'spectator' };
const SETTINGS = path.join(__dirname, '..', 'data', 'game-mode.json');
function normalizeGameMode(value) {
  if (Number.isInteger(value)) return MODES[value] || null;
  const name = String(value ?? '').trim().toLowerCase().replace(/模式$/, '');
  return MODES.includes(name) ? name : ALIASES[name] || (/^[0-3]$/.test(name) ? MODES[Number(name)] : null);
}
function currentGameMode(bot) { return normalizeGameMode(bot.game?.gameMode); }
function detectGameModeRequest(message) {
  const direct = message.match(/^!(?:gamemode|gm)\s+(\S+)\s*$/i);
  if (direct) return normalizeGameMode(direct[1]);
  if (/为什么|是否|有没有|\bwhy\b|\bmy\b|把我(?!自己)/i.test(message)) return null;
  if (!/切|设|改|\bset\b|\bswitch\b|\bchange\b/i.test(message)) return null;
  const mode = message.match(/生存|创造|冒险|旁观|观察|\bsurvival\b|\bsurvive\b|\bcreative\b|\badventure\b|\bspectator\b/i);
  return mode ? normalizeGameMode(mode[0]) : null;
}
function desiredGameMode(config, filename = SETTINGS) {
  try { const saved = JSON.parse(fs.readFileSync(filename, 'utf8')); if (saved.username === config.username && saved.owner === config.owner) return normalizeGameMode(saved.gameMode) || 'survival'; } catch (_) {}
  return normalizeGameMode(config.botGameMode) || 'survival';
}
function saveGameMode(config, mode, filename = SETTINGS) {
  try {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename + '.tmp', JSON.stringify({ username: config.username, owner: config.owner, gameMode: mode }, null, 2));
    fs.renameSync(filename + '.tmp', filename); return true;
  } catch (error) { console.error('[GameMode] 偏好保存失败:', error.message); return false; }
}
async function switchGameMode(bot, requested, { assertActive = () => {}, timeout = 8000, state=global.state||{} } = {}) {
  const mode = normalizeGameMode(requested);
  if (!mode) throw new Error('无效游戏模式，请使用 survival、creative、adventure 或 spectator。');
  assertActive();
  if (currentGameMode(bot) === mode) return mode;
  require('./command-permissions').requireAllowed(bot,state);
  bot.chat(`/gamemode ${mode} @s`);
  const deadline = Date.now() + timeout;
  while (currentGameMode(bot) !== mode) {
    assertActive();
    if (bot._client && bot._client.state !== 'play') throw new Error('连接已断开，游戏模式未确认。');
    if (Date.now() >= deadline) throw new Error(`服务器未确认切换到${LABELS[mode]}模式；当前为${LABELS[currentGameMode(bot)] || '未知'}模式，请检查机器人权限。`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assertActive(); return mode;
}
async function runGameModeTask(bot, state, config, mode, assertActive = () => {}, options = {}) {
  if (state._gamemodeTask) throw new Error('正在切换游戏模式，请稍等。');
  const token = {}; const epoch = state._commandEpoch || 0;
  state._gamemodeTask = token; state.mode = 'gamemode'; state.currentTask = '切换游戏模式';
  const active = () => { assertActive(); if ((state._commandEpoch || 0) !== epoch) throw Object.assign(new Error('模式切换已停止'), { code: 'TASK_CANCELLED' }); };
  try {
    const confirmed = await switchGameMode(bot, mode, { ...options, assertActive: active, state });
    const saved = saveGameMode(config, confirmed, options.filename);
    return { gameMode: confirmed, message: `服务器已确认：我当前是${LABELS[confirmed]}模式。${saved ? '重连后也会保持该模式。' : '模式偏好保存失败，请检查本地写入权限。'}` };
  } finally { if (state._gamemodeTask === token) { state._gamemodeTask = null; if ((state._commandEpoch || 0) === epoch && state.mode === 'gamemode') { state.mode = 'idle'; state.currentTask = null; } } }
}
module.exports = { normalizeGameMode, currentGameMode, detectGameModeRequest, desiredGameMode, switchGameMode, runGameModeTask };
