const { pauseWanderingForCommand } = require('./task-control');

async function dropItem(bot, state, config, args, assertActive = () => {}) {
  const keyword = String(args.item || '').replace(/^minecraft:/, '');
  if (!keyword) throw new Error('请指定要交出的物品。');
  const items = bot.inventory.items();
  const stack = items.find(item => item.name === keyword) || items.find(item => item.name.includes(keyword));
  if (!stack) throw new Error(`背包里没有 ${keyword}。`);
  const available = () => bot.inventory.items().filter(item => item.type === stack.type && item.metadata === stack.metadata).reduce((total, item) => total + item.count, 0);
  const count = args.count === undefined ? available() : args.count;
  if (!Number.isSafeInteger(count) || count <= 0) throw new Error('交出数量必须是正整数。');
  if (available() < count) throw new Error(`背包里只有 ${available()} 个 ${stack.name}，不足 ${count} 个。`);
  const recipient = args.player || config.owner;
  const epoch = state._commandEpoch || 0;
  const check = () => {
    assertActive();
    if ((state._commandEpoch || 0) !== epoch) {
      const error = new Error('交付任务已停止'); error.code = 'TASK_CANCELLED'; throw error;
    }
  };
  pauseWanderingForCommand(bot, state);
  state.mode = 'delivering';
  state.currentTask = `交付 ${count} 个 ${stack.name}`;
  try {
    check();
    if (recipient) {
      const player = bot.players[recipient]?.entity;
      if (!player) throw new Error(`找不到 ${recipient}，请走到我附近再让我交付。`);
      if (player.position.distanceTo(bot.entity.position) > 2.5) {
        const target = player.position;
        await require('./navigation').navigateTo(target.x, target.y, target.z, bot, { state, assertActive: check, timeout: 20000, range: 2 });
      }
      check();
      const currentPlayer = bot.players[recipient]?.entity;
      if (!currentPlayer || currentPlayer.position.distanceTo(bot.entity.position) > 3) throw new Error('玩家移动到远处了，请靠近我再交付。');
      await bot.lookAt(currentPlayer.position.offset(0, 1, 0));
      check();
    }
    const before = available();
    await bot.toss(stack.type, stack.metadata, count);
    check();
    const removed = before - available();
    if (removed !== count) throw new Error(`交付数量未确认：预计 ${count} 个，背包减少了 ${removed} 个。`);
    return { item: stack.name, count, player: recipient, message: `已${recipient ? '在你面前' : ''}丢出 ${count} 个 ${stack.name}。` };
  } finally {
    if ((state._commandEpoch || 0) === epoch) {
      state.mode = 'idle'; state.currentTask = null;
      bot.pathfinder.setGoal(null); bot.clearControlStates();
    }
  }
}

module.exports = { dropItem };
