const { craftItem, placeItem } = require('./crafting-basic');
const { pauseWanderingForCommand } = require('./task-control');

// Both AI actions and explicit !craft/!place commands use this awaited task.
async function runCraftingTask(tool, args, bot, state, assertActive = () => {}) {
  assertActive();
  if (state._craftTask || !['idle', 'thinking'].includes(state.mode)) {
    throw new Error('正在执行其他任务，请先用 !stop 停下，再合成或放置。');
  }
  pauseWanderingForCommand(bot, state);
  bot.pathfinder.setGoal(null);
  bot.clearControlStates();
  state._lastGotoTarget = null;
  const epoch = state._commandEpoch || 0;
  const task = {};
  state._craftTask = task;
  const check = () => {
    assertActive();
    if ((state._commandEpoch || 0) !== epoch) {
      const error = new Error('任务已停止');
      error.code = 'TASK_CANCELLED';
      throw error;
    }
  };
  const item = args.item || args.block;
  try {
    state.mode = tool === 'craft' ? 'crafting' : 'placing';
    state.currentTask = `${tool === 'craft' ? '合成' : '放置'} ${item || ''}`;
    let crafted;
    if (tool === 'craft') {
      crafted = await craftItem(bot, item, args.count ?? 1, { assertActive: check });
      check();
      console.log('[Craft] Completed:', JSON.stringify(crafted));
    }
    if (tool === 'place' || args.place === true) {
      state.mode = 'placing';
      state.currentTask = `放置 ${item}`;
      const placed = await placeItem(bot, item, { assertActive: check });
      check();
      console.log('[Place] Completed:', JSON.stringify(placed));
      return { crafted, placed, message: `${crafted ? crafted.message + ' ' : ''}${placed.message}` };
    }
    return { crafted, message: crafted.message };
  } finally {
    if (state._craftTask === task) {
      state._craftTask = null;
      if ((state._commandEpoch || 0) === epoch) {
        state.mode = 'idle';
        state.currentTask = null;
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
      }
    }
  }
}

module.exports = { runCraftingTask };
