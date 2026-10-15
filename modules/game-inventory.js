const { stopCurrentTask } = require('./task-control');

function attachGameInventory(bot, state, config) {
  let autoEatWasEnabled = false;
  const onMessage = message => {
    const signal = String(message).match(/^\[BOT_UI\] (OPEN|CLOSE) ([A-Za-z0-9_]{1,16})$/);
    if (!signal || signal[2] !== config.owner) return;
    if (signal[1] === 'OPEN') {
      if (state._gameInventoryTask) return;
      stopCurrentTask(bot, state);
      state._gameInventoryTask = { owner: signal[2] };
      state.mode = 'inventory'; state.currentTask = '主人正在游戏内管理背包';
      autoEatWasEnabled = bot.autoEat?.enabled === true;
      if (autoEatWasEnabled) bot.autoEat.disableAuto();
    } else if (state._gameInventoryTask) {
      state._gameInventoryTask = null;
      if (state.mode === 'inventory') { state.mode = 'idle'; state.currentTask = null; }
      if (autoEatWasEnabled) bot.autoEat?.enableAuto();
      autoEatWasEnabled = false;
    }
  };
  bot.on('messagestr', onMessage);
  bot.on('end', () => { state._gameInventoryTask = null; autoEatWasEnabled = false; });
}
module.exports = { attachGameInventory };
