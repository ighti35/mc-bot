const { waitForAction } = require('./task-control');

// Mineflayer locally replaces the block with air before server acknowledgement.
// Keep one target/tool until a real server packet confirms that it was removed.
async function digConfirmed(bot, block, { state, assertActive = () => {}, prepare = async () => {}, timeout = 15000, confirmationTimeout = 2000 } = {}) {
  if (state?._digTask) throw new Error('已有方块正在挖掘。');
  const token = {};
  if (state) state._digTask = token;
  const autoEatEnabled = bot.autoEat?.enabled === true;
  if (autoEatEnabled) bot.autoEat.disableAuto();
  const client = bot._client;
  const canConfirm = Boolean(client?.on && client?.removeListener);
  let confirm;
  const confirmed = new Promise(resolve => { confirm = resolve; });
  const accepts = (position, stateId) => {
    if (!position || position.x !== block.position.x || position.y !== block.position.y || position.z !== block.position.z) return;
    const name = bot.registry.blocksByStateId?.[stateId]?.name;
    if (stateId === 0 || ['air','cave_air','void_air'].includes(name)) confirm();
  };
  const single = packet => accepts(packet.location, packet.type);
  const batch = packet => {
    for (const record of packet.records || []) {
      if (packet.chunkCoordinates && (typeof record === 'number' || typeof record === 'bigint')) {
        const data = BigInt(record), c = packet.chunkCoordinates;
        accepts({ x:c.x*16+Number((data>>8n)&15n), y:c.y*16+Number(data&15n), z:c.z*16+Number((data>>4n)&15n) },Number(data>>12n));
      } else if (record && typeof record === 'object') {
        accepts({x:packet.chunkX*16+(record.horizontalPos>>4),y:record.y,z:packet.chunkZ*16+(record.horizontalPos&15)},record.blockId);
      }
    }
  };
  const stop = () => { try { bot.stopDigging(); } catch (_) {} };
  try {
    // An already-running meal must finish before we choose and hold the pickaxe.
    if (bot.autoEat?.isEating) {
      let poll;
      try {
        await waitForAction(new Promise(resolve => {
          poll = setInterval(() => { if (!bot.autoEat.isEating) resolve(); },25);
        }), { assertActive, timeout: 4000 });
      } finally { clearInterval(poll); }
    }
    assertActive();
    await prepare();
    assertActive();
    // A newly reached vein can be scanned before the final landing physics tick.
    // Let that landing complete instead of freezing the airborne 5x penalty for the entire dig.
    if(bot.entity?.onGround===false){
      bot.clearControlStates?.();
      const until=Date.now()+2000;let stable=0;
      while(Date.now()<until&&stable<3){
        assertActive();await new Promise(resolve=>setTimeout(resolve,50));
        stable=bot.entity.onGround?stable+1:0;
      }
    }
    assertActive();
    const predicted=typeof bot.digTime==='function'?bot.digTime(block):0;
    if(!Number.isFinite(predicted))throw new Error(`当前条件无法挖掘 ${block.name}。`);
    const digTimeout=Math.max(timeout,Math.min(120000,predicted+5000));
    if (canConfirm) { client.on('block_change',single);client.on('multi_block_change',batch); }
    await waitForAction(bot.dig(block,true),{assertActive,timeout:digTimeout,onInterrupt:stop});
    if (canConfirm) {
      try { await waitForAction(confirmed,{assertActive,timeout:confirmationTimeout,onInterrupt:stop}); }
      catch(error) { assertActive(); throw new Error(`服务器未确认 ${block.name} 被挖下，停止切换目标，避免方块恢复。`); }
    }
    assertActive();
    const after = bot.blockAt(block.position);
    if (!after || after.type === block.type) throw new Error(`没有确认挖下 ${block.name}。`);
  } catch(error) { assertActive(); throw error; }
  finally {
    client?.removeListener?.('block_change',single);client?.removeListener?.('multi_block_change',batch);
    if (state?._digTask === token) state._digTask = null;
    if (autoEatEnabled && !state?._gameInventoryTask && !state?._inventoryTask && bot.health > 0) bot.autoEat.enableAuto();
  }
}

module.exports = { digConfirmed };
