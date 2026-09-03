// mc-bot/modules/thinklog.js — AI 思考过程彩色日志工具
// 用于在终端实时展示 Claude_Bot 的完整思考链路

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  // 前景色
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
  black: '\x1b[30m',
  // 背景色
  bgWhite: '\x1b[47m',
  bgBlue: '\x1b[44m',
};

// 时间戳
function ts() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

// 分隔线
function rule(label = '', color = ANSI.cyan) {
  const width = 62;
  const filled = label ? ` ${label} ` : '';
  const pad = Math.max(0, Math.floor((width - filled.length) / 2));
  const line = '─'.repeat(pad) + filled + '─'.repeat(width - pad - filled.length);
  console.log(`${color}${line}${ANSI.reset}`);
}

// 主标题模块（如 "AI THINKING"）
function header(label) {
  console.log(`${ANSI.bold}${ANSI.magenta}╔══════════════════════════════════════════════════════╗${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.magenta}║   ${label}${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.magenta}╚══════════════════════════════════════════════════════╝${ANSI.reset}`);
}

// 1) 用户消息
function userMessage(username, message) {
  console.log(`${ANSI.cyan}[${ts()}]${ANSI.reset} ${ANSI.bold}用户 (${username}):${ANSI.reset} ${ANSI.white || ANSI.reset}${message}`);
}

// 2) AI 收到的上下文 (喂给 DeepSeek 的 gameContext)
function contextIn(context, gameContext) {
  console.log(`\n${ANSI.bgBlue}${ANSI.bold}  CONTEXT 送给AI的状态 ${ANSI.reset}`);
  // gameContext 格式: "Key:value Key2:value2 ..." 其中 value 本身可能含空格（Inv/Nearby）
  // 用正则按 "字段名:" 定位拆分
  const labelMap = {
    Pos: '位置', HP: '血量', Food: '饱食', Mode: '模式', Task: '任务',
    Inv: '背包', Nearby: '附近', EnchBooks: '附魔书', Search: '搜索', Recent: '最近动作',
  };
  const colorMap = {
    HP: ANSI.red, Nearby: ANSI.yellow, Inv: ANSI.green,
    Pos: ANSI.magenta, EnchBooks: ANSI.blue, Recent: ANSI.yellow,
  };
  // 匹配 /(Key):(value)/ 直到下一个 Key:
  const re = /(\w+):([^]+?)(?=\s\w+:|\s*$)/g;
  let m;
  while ((m = re.exec(gameContext)) !== null) {
    const k = m[1];
    const v = m[2].trim();
    const color = colorMap[k] || ANSI.cyan;
    console.log(`  ${ANSI.gray}${labelMap[k] || k}:${ANSI.reset} ${color}${v}${ANSI.reset}`);
  }
}

// 3) AI 原始回复文本
function rawReply(rawText) {
  console.log(`${ANSI.magenta}  AI 原始回复:${ANSI.reset}`);
  console.log(`  ${ANSI.bold}${ANSI.magenta}${rawText}${ANSI.reset}`);
}

// 4) 解析出的动作清单
function actionList(parsed) {
  if (!parsed.actions || parsed.actions.length === 0) {
    console.log(`  ${ANSI.dim}${ANSI.gray}（无动作，纯回复）${ANSI.reset}`);
    return;
  }
  console.log(`${ANSI.yellow}  将要执行的动作 (${parsed.actions.length}):${ANSI.reset}`);
  for (let i = 0; i < parsed.actions.length; i++) {
    const a = parsed.actions[i];
    const short = JSON.stringify(a.args || {});
    console.log(`    ${ANSI.bold}${i + 1}.${ANSI.reset} ${ANSI.blue}${a.tool}${ANSI.reset} ${ANSI.dim}${short}${ANSI.reset}`);
  }
}

// 5) 单个动作开始
function actionStart(tool, args) {
  const short = JSON.stringify(args || {});
  console.log(`  ${ANSI.dim}▸ 开始 ${ANSI.blue}${tool}${ANSI.reset}${ANSI.dim} ${short}${ANSI.reset}`);
}

// 6) 动作成功
function actionOk(tool, detail = '') {
  console.log(`  ${ANSI.green}✓ ${tool}${ANSI.reset}${detail ? ` ${ANSI.dim}${detail}${ANSI.reset}` : ''}`);
}

// 7) 动作失败
function actionFail(tool, detail = '') {
  console.log(`  ${ANSI.red}✗ ${tool}${ANSI.reset}${detail ? ` ${ANSI.red}${detail}${ANSI.reset}` : ''}`);
}

// 8) 最终给玩家的聊天回复
function finalChat(chatText) {
  console.log(`${ANSI.bgWhite}${ANSI.bold}  【说给玩家】${ANSI.reset} ${ANSI.bold}${chatText}${ANSI.reset}`);
}

// 思考流结束
function end() {
  console.log('');
}

module.exports = {
  ts, rule, header,
  userMessage, contextIn, rawReply, actionList,
  actionStart, actionOk, actionFail, finalChat, end,
};
