const { pauseWanderingForCommand } = require('./task-control');
const { navigateTo } = require('./navigation');

async function goTo(bot, state, target, options = {}) {
  if (!['idle', 'thinking'].includes(state.mode)) throw new Error('已有任务，请先用 !stop。');
  if (options.adaptive !== false) {
    return require('./journey').travelJourney(bot,state,options.config||global.config||{},{x:target.x,y:target.y,z:target.z,targetY:target.y,getTarget:options.getTarget,arrivalRange:options.range??1,allowTower:options.allowTower===true,lead:false,label:'目标',timeout:options.timeout??90000},options.assertActive);
  }
  pauseWanderingForCommand(bot, state);
  const epoch = state._commandEpoch || 0;
  state.mode = 'navigating'; state.currentTask = `前往 (${target.x},${target.y},${target.z})`;
  state._lastGotoTarget = null;
  const check = () => {
    options.assertActive?.();
    if ((state._commandEpoch || 0) !== epoch) { const error = new Error('导航已停止'); error.code = 'TASK_CANCELLED'; throw error; }
  };
  try {
    const result = await navigateTo(target.x, target.y, target.z, bot, { ...options, state, assertActive: check });
    check();
    return { ...result, message: `已到达 (${Math.round(result.position.x)},${Math.round(result.position.y)},${Math.round(result.position.z)})。` };
  } finally {
    if ((state._commandEpoch || 0) === epoch) { state.mode = 'idle'; state.currentTask = null; }
  }
}

module.exports = { goTo };
