// mc-bot/modules/death-analyzer.js — 死亡分析 + 自动总结
const fs = require('fs');
const path = require('path');

const reportsDir = path.join(__dirname, '..', 'data', 'death-reports');

// 确保目录存在
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

/**
 * 初始化死亡分析器
 * @param {Bot} bot
 * @param {object} state
 * @param {object} config
 */
function initDeathAnalyzer(bot, state, config) {
  if (!config.aiApiKey) {
    console.log('[Death] AI API Key 未配置，死亡分析仅记录本地');
  }

  // 持续追踪最近的事件上下文
  const recentEvents = [];
  const MAX_EVENTS = 20;

  function logEvent(type, detail) {
    recentEvents.push({ time: Date.now(), type, detail });
    if (recentEvents.length > MAX_EVENTS) recentEvents.shift();
  }

  // 追踪受伤
  bot.on('entityHurt', (entity) => {
    if (entity === bot.entity) return;
    logEvent('hurt_by', `${entity.name || entity.username || 'mob'} - HP:${Math.round(bot.health)}`);
  });

  bot.on('damage', () => {
    logEvent('damage', `HP:${Math.round(bot.health)}`);
  });

  // 追踪进入危险状态
  let lastHealth = 20;
  setInterval(() => {
    if (bot.entity && bot.health < lastHealth) {
      logEvent('health_drop', `HP ${Math.round(lastHealth)} → ${Math.round(bot.health)}`);
      lastHealth = bot.health;
    } else if (bot.entity && bot.health > lastHealth + 2) {
      lastHealth = bot.health;
    }
  }, 2000);

  // === 死亡事件 ===
  bot.on('death', () => {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const pos = bot.entity?.position;

    // 构建死亡报告
    const report = {
      timestamp: now.toISOString(),
      position: pos ? { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) } : 'unknown',
      dimension: bot.game?.dimension || 'unknown',
      mode: state.mode,
      task: state.currentTask || 'none',
      heldItem: bot.heldItem ? (bot.heldItem.displayName || bot.heldItem.name) : 'none',
      armor: [5, 6, 7, 8].map(s => bot.inventory.slots[s]).filter(Boolean).map(i => i.displayName || i.name),
      inventory: bot.inventory.items().slice(0, 8).map(i => `${i.count}x ${i.name}`),
      recentEvents: recentEvents.slice(-MAX_EVENTS),
      actionHistory: (state.stats.actionHistory || []).slice(-20),
      nearbyEntities: Object.values(bot.entities || {})
        .filter(e => e !== bot.entity && e.position && pos && e.position.distanceTo(pos) < 16)
        .slice(0, 8)
        .map(e => ({
          name: e.name || e.username || e.mobType || 'unknown',
          distance: pos ? Math.round(e.position.distanceTo(pos)) : '?',
          hp: e.health ? Math.round(e.health) : '?',
        })),
    };

    // 保存本地报告
    const reportFile = path.join(reportsDir, `death-${timestamp}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`[Death] 报告已保存: ${reportFile}`);

    // 可读摘要
    const summary = buildSummary(report);
    fs.writeFileSync(path.join(reportsDir, `death-${timestamp}.md`), summary);
    console.log(`[Death] ===== 死亡分析 =====\n${summary}\n========================`);

    // 发送到 AI 分析
    if (config.aiApiKey) {
      analyzeWithAI(report, config).then(analysis => {
        fs.writeFileSync(path.join(reportsDir, `death-${timestamp}-analysis.md`), analysis);
        console.log(`[Death] AI 分析完成 → ${reportsDir}/death-${timestamp}-analysis.md`);
      }).catch(e => console.error('[Death] AI 分析失败:', e.message));
    }

    // 清空事件
    recentEvents.length = 0;
  });
}

function buildSummary(report) {
  const lines = [
    `# 死亡报告 — ${report.timestamp}`,
    '',
    `- **位置**: (${report.position.x}, ${report.position.y}, ${report.position.z}) — ${report.dimension}`,
    `- **当前任务**: ${report.mode} / ${report.task}`,
    `- **手持物品**: ${report.heldItem}`,
    `- **盔甲**: ${report.armor.join(', ') || '无'}`,
    `- **背包**: ${report.inventory.join(', ') || '空'}`,
    '',
    '## 附近生物',
    ...(report.nearbyEntities.length > 0
      ? report.nearbyEntities.map(e => `- ${e.name} (${e.distance}m, HP:${e.hp})`)
      : ['- 无']),
    '',
    '## 最近事件',
    ...report.recentEvents.map(e => `- ${new Date(e.time).toLocaleTimeString()} [${e.type}] ${e.detail}`),
    '',
    '## 最近动作',
    ...(report.actionHistory.length > 0
      ? report.actionHistory.map(a => `- [${a.success ? '✓' : '✗'}] ${a.action}: ${a.detail}`)
      : ['- 无记录']),
  ];
  return lines.join('\n');
}

async function analyzeWithAI(report, config) {
  const prompt = `Claude_Bot (a Minecraft bot) just DIED. Analyze the death context below and provide:
1. Root cause of death
2. What code/bot behavior should be changed to prevent this
3. Priority: critical / high / medium / low

## Death Context
- Position: (${report.position.x}, ${report.position.y}, ${report.position.z}) in ${report.dimension}
- Mode: ${report.mode}, Task: ${report.task}
- Held: ${report.heldItem}
- Armor: ${report.armor.join(', ') || 'none'}
- Nearby: ${report.nearbyEntities.map(e => `${e.name}(${e.distance}m)`).join(', ') || 'none'}
- Recent Events: ${report.recentEvents.map(e => `[${e.type}] ${e.detail}`).join('; ') || 'none'}
- Recent Actions: ${(report.actionHistory || []).map(a => `[${a.success ? 'OK' : 'FAIL'}] ${a.action}: ${a.detail}`).join('; ') || 'none'}

Respond with a concise analysis in Chinese, then suggest specific code changes.`;

  const response = await fetch(config.aiApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.aiApiKey}`,
    },
    body: JSON.stringify({
      model: config.aiModel || 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are an expert Minecraft bot debugger. Analyze death causes and suggest code fixes. Respond in Chinese.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    }),
  });

  const data = await response.json();
  const analysis = data.choices?.[0]?.message?.content?.trim() || 'AI analysis unavailable';
  return `# AI 死亡分析\n\n${analysis}\n\n---\n*Generated by DeepSeek at ${new Date().toISOString()}*`;
}

module.exports = { initDeathAnalyzer };
