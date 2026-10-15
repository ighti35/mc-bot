// Command handling takes priority over background wandering.
const { stopWandering } = require('./wander');
const { resetStuckTimer } = require('./anti-stuck');

function pauseWanderingForCommand(bot, state) {
  const wasWandering = state._wanderEnabled;
  state._wanderEnabled = false;
  stopWandering();
  if (wasWandering && state.mode === 'idle') {
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    state._lastGotoTarget = null;
    resetStuckTimer();
  }
}

function stopCurrentTask(bot, state) {
  state._commandAuthorization=null;state._pendingCommandAuthorization=null;state._commandRestriction=null;
  state._buildPanelTask=null;
  state._commandEpoch = (state._commandEpoch || 0) + 1;
  state._aiRequest?.controller.abort();
  for (const request of state._aiRequests || []) request.controller.abort();
  if (state._enchanting) state._enchanting.cancelled = true;
  require('./item-goal').stopItemGoal(state);
  pauseWanderingForCommand(bot, state);
  if (!state._enchanting && !state._itemGoal && !state._crafting) { state.mode = 'idle'; state.currentTask = null; }
  state._lastGotoTarget = null;
  bot.pathfinder.setGoal(null);
  bot.clearControlStates();
  try { bot.stopDigging(); } catch (_) {}
  if (bot.collectBlock) {
    Promise.resolve(bot.collectBlock.cancelTask()).catch(err => {
      console.log('[Task] Cancel collection:', err.message);
    });
  }
  resetStuckTimer();
}

// Bound an awaited action and let !stop interrupt it while it is pending.
async function waitForAction(promise, { assertActive = () => {}, timeout = 30000, onInterrupt = () => {} } = {}) {
  let timer;
  let poll;
  try {
    const interruption = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`操作超时 (${Math.round(timeout / 1000)} 秒)`)), timeout);
      poll = setInterval(() => {
        try { assertActive(); } catch (error) { reject(error); }
      }, 100);
    });
    const result = await Promise.race([promise, interruption]);
    assertActive();
    return result;
  } catch (error) {
    try { onInterrupt(); } catch (_) {}
    throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }
}

module.exports = { pauseWanderingForCommand, stopCurrentTask, waitForAction };
