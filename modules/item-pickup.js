const { navigateTo } = require('./navigation');
const { canStand } = require('./terrain');
const { pauseWanderingForCommand } = require('./task-control');

function scanDroppedItems(bot, { radius = 16, names, maxItems = 64 } = {}) {
  if (!bot.entity?.position) return [];
  return Object.values(bot.entities || {}).flatMap(entity => {
    if (entity.isValid === false || !['item', 'Item', 'item_stack'].includes(entity.name) || !entity.position) return [];
    const distance = entity.position.distanceTo(bot.entity.position);
    if (distance > radius) return [];
    let item;
    try { item = entity.getDroppedItem?.(); } catch (_) {}
    if (names && !names.includes(item?.name)) return [];
    return [{ entity, id: entity.id, name: item?.name || null, label: item?.displayName || item?.name || '物品信息尚未同步', count: item?.count ?? null, distance, position: entity.position.clone() }];
  }).sort((a,b) => a.distance - b.distance).slice(0,maxItems);
}

function describeDroppedItems(bot, options = {}) {
  const drops = scanDroppedItems(bot, options);
  return drops.map(drop => `${drop.count ?? '?'}x ${drop.name || 'unknown_item'} (${drop.distance.toFixed(1)}m @${drop.position.floored()})`).join('; ') || 'none';
}

async function collectNearbyItems(bot, { state, assertActive = () => {}, radius = 5, timeout = 3000, names, maxItems = 12 } = {}) {
  const deadline = Date.now() + timeout;
  // Entity spawn can precede the item-stack metadata packet.
  if (names && scanDroppedItems(bot, { radius }).some(drop => !drop.name)) {
    const until = Math.min(deadline, Date.now() + 300);
    while (Date.now() < until && scanDroppedItems(bot, { radius }).some(drop => !drop.name)) {
      assertActive(); await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  const drops = scanDroppedItems(bot, { radius, names, maxItems }).map(drop => drop.entity);
  let picked = 0;
  for (const entity of drops) {
    assertActive();
    if (Date.now() >= deadline) break;
    if (entity.isValid === false || !bot.entities[entity.id]) continue;
    const base = entity.position.floored();
    const ground = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -2; dy <= 2; dy++) {
      const point = base.offset(dx, dy, dz);
      if (canStand(bot, point) && point.offset(0.5, 0.5, 0.5).distanceTo(entity.position) <= 1.8) ground.push(point);
    }
    // Walk into pickup range, rather than stopping at the nearest marginal candidate.
    ground.sort((a, b) => a.offset(0.5, 0.5, 0.5).distanceTo(entity.position) - b.offset(0.5, 0.5, 0.5).distanceTo(entity.position) || a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    if (!ground.length) continue;
    try {
      const point = ground[0];
      await navigateTo(point.x, point.y, point.z, bot, { state, assertActive, exact: true, range: 0, timeout: Math.max(1, deadline - Date.now()), segmentTimeout: 6000, saveTrail: false });
      const until = Math.min(deadline, Date.now() + 650);
      while (bot.entities[entity.id] && entity.isValid !== false && Date.now() < until) {
        assertActive(); await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!bot.entities[entity.id] || entity.isValid === false) picked++;
    } catch (error) {
      assertActive();
      console.log('[Pickup] Skipped unreachable drop:', error.message);
    }
  }
  return picked;
}

async function runPickupTask(bot, state, options = {}, assertActive = () => {}) {
  const radius = options.radius ?? 12;
  if (!Number.isFinite(radius) || radius < 1 || radius > 32) throw new Error('拾取范围必须为 1 到 32 格。');
  if (state._pickupTask) throw new Error('已有拾取任务，请先用 !stop。');
  const item = options.item?.replace(/^minecraft:/, '');
  if (item && !bot.registry.itemsByName[item]) throw new Error(`无法识别物品：${item}`);
  const names = item ? [item] : undefined;
  const countItems = () => bot.inventory.items().reduce((counts,item) => counts.set(item.name,(counts.get(item.name)||0)+item.count),new Map());
  const before = countItems();
  const epoch = state._commandEpoch || 0, token = {};
  pauseWanderingForCommand(bot,state);
  state._pickupTask = token; state.mode = 'collecting'; state.currentTask = '拾取附近掉落物';
  const active = () => {
    assertActive();
    if ((state._commandEpoch || 0) !== epoch || state._pickupTask !== token || state.mode !== 'collecting') {
      const error = new Error('拾取已停止'); error.code = 'TASK_CANCELLED'; throw error;
    }
  };
  try {
    const visible = scanDroppedItems(bot,{radius,names});
    if (!visible.length && !scanDroppedItems(bot,{radius}).some(drop=>!drop.name)) throw new Error(`附近 ${radius} 格内没有${item || '可见'}掉落物。`);
    await collectNearbyItems(bot,{state,assertActive:active,radius,names,timeout:options.timeout ?? 15000,maxItems:32});
    const added = [...countItems()].map(([name,count])=>({name,count:Math.max(0,count-(before.get(name)||0))})).filter(i=>i.count>0 && (!item || i.name===item));
    const collected = added.reduce((sum,i)=>sum+i.count,0);
    if (!collected) throw new Error('看到了掉落物，但背包没有增加；可能无法到达、背包已满或物品被别人捡走。');
    state.stats ||= {};state.stats.itemsCollected=(state.stats.itemsCollected||0)+collected;
    return {collected,items:added,message:`已拾取并放入背包：${added.map(i=>`${i.count} 个 ${i.name}`).join('，')}。`};
  } finally {
    if (state._pickupTask===token) {
      state._pickupTask=null;
      if ((state._commandEpoch||0)===epoch && state.mode==='collecting') {state.mode='idle';state.currentTask=null;}
    }
  }
}

module.exports = { collectNearbyItems, scanDroppedItems, describeDroppedItems, runPickupTask };
