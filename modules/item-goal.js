const createItemGoal = require('./vendor/mindcraft-item-goal');
const { createData, inventoryCounts, itemSatisfied, describeItem } = require('./item-goal-data');
const { createActions } = require('./item-goal-actions');
const itemNames = require('./item-names');

function stopItemGoal(state) {
  const task = state._itemGoal;
  if (!task) return false;
  task.cancelled = true;
  task.cancel?.();
  return true;
}

async function obtainItem(name, count = 1, bot, state, options = {}) {
  const input = String(name || '').trim();
  const target = (itemNames[input] || input).toLowerCase().replace(/^minecraft:/, '');
  const quantity = Number(count);
  if (!bot.registry.itemsByName[target]) throw new Error(`未知物品：${input}`);
  if (!['number', 'string'].includes(typeof count) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 64) {
    throw new Error('目标数量必须是 1–64 的整数');
  }
  if (state._itemGoal || state._crafting || (state.mode && state.mode !== 'idle')) throw new Error('已有任务在执行，请先 !stop');
  const counts = () => inventoryCounts(bot);
  if ((counts()[target] || 0) >= quantity) {
    bot.chat(`已拥有 ${target} ×${quantity}，目标已满足。`);
    return { item: target, count: counts()[target], steps: 0 };
  }
  const task = {
    target, quantity, cancelled: false, steps: [],
    check() {
      if (this.cancelled) throw new Error('任务已停止');
      if (bot.health <= 6) throw new Error('生命值过低，暂停目标任务');
      if (state.mode !== 'obtaining') throw new Error('任务被其他动作打断');
    },
  };
  state._itemGoal = task;
  state.mode = 'obtaining';
  const skills = options.actions || createActions(bot, task);
  task.cancel = () => skills.cancel?.();
  const data = createData(bot);
  const ItemGoal = createItemGoal({ skills, world: { getInventoryCounts: inventoryCounts }, mc: data, itemSatisfied });
  const goal = new ItemGoal({ bot, npc: { getBuiltPositions: () => [] } });
  const abort = () => stopItemGoal(state);
  const onHealth = () => {
    if (bot.health <= 6) { task.reason = '生命值过低，暂停目标任务'; abort(); }
  };
  bot.once('death', abort);
  bot.once('end', abort);
  bot.on('health', onHealth);
  const timeout = setTimeout(() => { task.reason = '任务超过 20 分钟'; abort(); }, options.timeoutMs || 20 * 60 * 1000);
  let exploration = 0;
  let stalls = 0;
  let lastError = '';
  const completed = () => {
    bot.chat(`目标完成：背包中已有 ${target} ×${counts()[target]}`);
    return { item: target, count: counts()[target], steps: task.steps.length };
  };
  try {
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    bot.chat(`开始目标：获得 ${target} ×${quantity}；自动补齐材料和工具。`);
    for (let step = 0; step < (options.maxSteps || 256); step++) {
      task.check();
      if ((counts()[target] || 0) >= quantity) {
        return completed();
      }
      const next = goal.next(target, quantity);
      if (!next) {
        const missing = Object.values(goal.nodes).filter(node => !itemSatisfied(bot, node.name) && !goal.best.has(node.name));
        const detail = missing.slice(0, 3).map(node => `${node.name}：${describeItem(bot, node.name)}`).join('；');
        throw new Error(`前置获取路线未满足：${detail || describeItem(bot, target)}`);
      }
      const node = next.node;
      const detail = `${({ block: '采集', craft: '合成', smelt: '熔炼', hunt: '获取生物掉落', smith: '锻造' })[node.type] || node.type}: ${node.name} ×${next.quantity}`;
      state.currentTask = `目标 ${target} → ${detail}`;
      if (node.type === 'block' && !bot.findBlock({ matching: bot.registry.blocksByName[node.source].id, maxDistance: 128 })) {
        node.fails += 1;
        stalls += 1;
        if (stalls > 12 || exploration >= 12) throw new Error(`找不到可达资源 ${node.source}；${lastError}`);
        // Give the upstream planner a chance to select another wood/ore source first.
        if (stalls % 3 === 0) {
          bot.chat(`寻找 ${node.source}，探索附近区域…`);
          const exploreTimer = setTimeout(() => { task.reason = `探索超时：${node.source}`; abort(); }, options.stepTimeoutMs || 120000);
          try { await skills.explore(node.source, exploration++); } catch (error) { lastError = error.message; }
          finally { clearTimeout(exploreTimer); }
        }
        continue;
      }
      bot.chat(`下一步：${detail}`);
      const before = counts()[node.name] || 0;
      let actionTimer;
      try {
        // Cancel navigation/collection if a primitive gets stuck; retain ownership until it settles.
        actionTimer = setTimeout(() => { task.reason = `步骤超时：${detail}`; abort(); }, options.stepTimeoutMs || 120000);
        await node.execute(next.quantity);
        task.check();
        const gained = (counts()[node.name] || 0) - before;
        task.steps.push({ type: node.type, item: node.name, gained });
        if (gained <= 0) {
          if (++stalls >= 12) throw new Error(`执行无进展：${detail}`);
        } else stalls = 0;
      } catch (error) {
        if (task.cancelled || state.mode !== 'obtaining' || bot.health <= 6) throw error;
        node.fails += 1;
        lastError = error.message;
        if (++stalls >= 6) throw new Error(`无法继续 ${detail}：${lastError}`);
        bot.chat(`步骤失败，重新规划：${lastError.slice(0, 65)}`);
      } finally { clearTimeout(actionTimer); }
    }
    task.check();
    if ((counts()[target] || 0) >= quantity) return completed();
    throw new Error(`达到任务步骤上限；${lastError}`);
  } catch (error) {
    throw new Error(`${task.reason || error.message}；当前 ${target} ×${counts()[target] || 0}，已完成 ${task.steps.length} 步。熔炼中断时请检查附近熔炉。`, { cause: error });
  } finally {
    clearTimeout(timeout);
    bot.removeListener('death', abort);
    bot.removeListener('end', abort);
    bot.removeListener('health', onHealth);
    task.cancel();
    state.lastItemGoal = { target, quantity, steps: task.steps, completed: (counts()[target] || 0) >= quantity };
    if (state._itemGoal === task) {
      delete state._itemGoal;
      if (state.mode === 'obtaining') { state.mode = 'idle'; state.currentTask = null; }
    }
  }
}

module.exports = { obtainItem, stopItemGoal };
