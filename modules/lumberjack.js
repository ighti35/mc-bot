const { Vec3 } = require('vec3');
const { pauseWanderingForCommand, waitForAction } = require('./task-control');
const { navigateTo, safeMovements } = require('./navigation');
const { canStand } = require('./terrain');
const { collectNearbyItems } = require('./item-pickup');

const isLog = name => typeof name === 'string' && !name.startsWith('stripped_') && /_(log|wood|stem|hyphae)$/.test(name);
const key = point => `${point.x},${point.y},${point.z}`;
function chooseAxe(bot, block) {
  const rank = { netherite: 1, diamond: 2, iron: 3, stone: 4, golden: 5, wooden: 6 };
  const time = item => {
    try { return block.digTime(item.type, false, false, false, item.enchants || [], bot.entity.effects || {}); }
    catch (_) { return rank[item.name.split('_')[0]] || 10; }
  };
  return bot.inventory.items().filter(item => item.name.endsWith('_axe') &&
    (bot.registry.itemsByName[item.name]?.maxDurability ?? Infinity) - (item.durabilityUsed || 0) > 4)
    .sort((a, b) => time(a) - time(b))[0];
}
function treeLogs(bot, seed) {
  const queue = [seed.position], seen = new Set(), logs = [];
  while (queue.length && seen.size < 4096 && logs.length < 128) {
    const point = queue.shift();
    if (seen.has(key(point)) || point.distanceTo(seed.position) > 10) continue;
    seen.add(key(point));
    const block = bot.blockAt(point);
    if (block?.name !== seed.name) continue;
    logs.push(block);
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      if (x || y || z) queue.push(point.offset(x, y, z));
    }
  }
  return logs.sort((a, b) => a.position.y - b.position.y || a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
}

async function collectWood(bot, state, config = {}, count = 0, options = {}, assertActive = () => {}) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 256) throw new Error('木头数量必须是 0 到 256 的整数。');
  if (state._chopTask) throw new Error('已有砍树任务，请先用 !stop。');
  const name = options.block?.replace(/^minecraft:/, '');
  if (name && !isLog(name)) throw new Error(`无法识别原木：${name}`);
  const matching = block => isLog(block?.name) && (!name || block.name === name);
  const total = () => bot.inventory.items().filter(item => matching(item)).reduce((n, item) => n + item.count, 0);
  const before = total(), token = {}, epoch = state._commandEpoch || 0;
  const skipped = new Set(), harvestedNames = new Set();
  const previous = bot.pathfinder.movements;
  const deadline = Date.now() + (options.timeout ?? Math.max(120000, count * 10000));
  let chopped = 0, trees = 0, failure, lastFailure;
  pauseWanderingForCommand(bot, state);
  state._chopTask = token; state.mode = 'chopping';
  state.stats ||= {};
  const active = () => {
    assertActive();
    if ((state._commandEpoch || 0) !== epoch || state._chopTask !== token || state.mode !== 'chopping') {
      const error = new Error('砍树任务已停止'); error.code = 'TASK_CANCELLED'; throw error;
    }
  };
  const safe = () => {
    active();
    if (Date.now() >= deadline) throw new Error(`砍树超时，已砍 ${chopped} 块，实际收到 ${total() - before} 块。`);
    if (bot.health <= 8 || bot.food <= 5) throw new Error('生命值或饱食度不足，停止砍树。');
    if ((bot.inventory.emptySlotCount?.() ?? 1) < 1) throw new Error('背包已满，停止砍树。');
  };
  const interrupt = () => { bot.pathfinder.setGoal(null); try { bot.stopDigging(); } catch (_) {} };
  try {
    bot.pathfinder.setMovements(safeMovements(bot));
    while (count ? chopped < count : trees < 1) {
      safe();
      state.currentTask = `砍树 (${total() - before}/${count || '一棵树'})`;
      const positions = bot.findBlocks({ matching, maxDistance: 48, count: 512 })
        .filter(point => !skipped.has(key(point))).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
      if (!positions.length) throw new Error(`附近没有更多可采集的原木，已砍 ${chopped} 块，实际收到 ${total() - before}/${count || chopped} 块。${lastFailure ? '原因：' + lastFailure : ''}`);
      const seed = bot.blockAt(positions[0]);
      let cut = 0;
      for (const old of treeLogs(bot, seed)) {
        safe();
        if (count && chopped >= count) break;
        skipped.add(key(old.position));
        const block = bot.blockAt(old.position);
        if (!matching(block)) continue;
        const axe = chooseAxe(bot, block);
        if (!axe) throw new Error('背包里没有耐久足够的斧头，请先给我一把斧头。');
        try {
          if (!bot.canDigBlock(block)) {
            const ground = [], feet = bot.entity.position.floored();
            for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = -2; dy <= 1; dy++) {
              const point = new Vec3(block.position.x + dx, feet.y + dy, block.position.z + dz);
              if (canStand(bot, point) && point.offset(0.5, 1.62, 0.5).distanceTo(block.position.offset(0.5, 0.5, 0.5)) < 4.5) ground.push(point);
            }
            ground.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
            for (const point of ground.slice(0, 3)) {
              try { await navigateTo(point.x, point.y, point.z, bot, { state, assertActive: safe, exact: true, range: 0, timeout: 6000, saveTrail: false }); }
              catch (error) { safe(); lastFailure = error.message; }
              if (bot.canDigBlock(block)) break;
            }
            if (!bot.canDigBlock(block)) { lastFailure = '剩余原木过高或没有可达落脚点'; continue; }
          }
          await require('./dig-confirmed').digConfirmed(bot,block,{state,assertActive:safe,prepare:async()=>{
            await waitForAction(bot.equip(axe, 'hand'), { assertActive: safe, timeout: 5000, onInterrupt: interrupt });
            if (bot.heldItem?.name !== axe.name) throw new Error('没有确认斧头已装备。');
          }});
          const after = bot.blockAt(block.position);
          if (!after || after.name === block.name) throw new Error('未确认原木挖下。');
          chopped++; cut++; harvestedNames.add(block.name);
          state.stats.blocksMined = (state.stats.blocksMined || 0) + 1;
          if (bot.waitForTicks) await waitForAction(bot.waitForTicks(3), { assertActive: safe, timeout: 1000 });
          await collectNearbyItems(bot, { state, assertActive: safe, names: [...harvestedNames], timeout: 2500 });
        } catch (error) {
          safe(); lastFailure = error.message;
          console.log('[Tree] Skipped log:', error.message);
        }
      }
      if (cut) trees++;
    }
    await collectNearbyItems(bot, { state, assertActive: safe, names: [...harvestedNames], radius: 6, timeout: 4000 });
    const collected = total() - before;
    if (count && collected < count) throw new Error(`已砍 ${chopped} 块，但背包实际收到 ${collected}/${count} 块，部分掉落物无法拾取。`);
    state.stats.itemsCollected = (state.stats.itemsCollected || 0) + collected;
    return { chopped, collected, trees, message: `已砍 ${chopped} 块原木，背包实际增加 ${collected} 块。` };
  } catch (error) { failure = error.message; throw error; }
  finally {
    interrupt(); bot.clearControlStates(); bot.pathfinder.setMovements(previous);
    state._lastChoppingResult = { chopped, collected: total() - before, trees, failure };
    if (state._chopTask === token) {
      state._chopTask = null;
      if ((state._commandEpoch || 0) === epoch && state.mode === 'chopping') { state.mode = 'idle'; state.currentTask = null; }
    }
  }
}
async function chopNearestTree(bot, state, options = {}) {
  return (await collectWood(bot, state, {}, options.count ?? 0, options)).collected;
}
module.exports = { collectWood, chopNearestTree, chooseAxe, isLog };
