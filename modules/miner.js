// Await each block's collection; scan predicates must also accept palette blocks without positions.
const { pauseWanderingForCommand, waitForAction } = require('./task-control');

async function startMiner(blockName, bot, state, config, count = 0, options = {}) {
  blockName = String(blockName || 'iron_ore').replace(/^minecraft:/, '');
  if (require('./lumberjack').isLog(blockName)) return require('./lumberjack').collectWood(bot, state, config, count, { ...options, block: blockName });
  if (options.strategy !== undefined && !['auto', 'branch', 'nearby', 'targeted'].includes(options.strategy)) throw new Error('挖矿策略必须是 auto、branch、nearby 或 targeted。');
  const { oreProfile } = require('./mining-plan');
  const profile = oreProfile(blockName, bot.game?.dimension);
  if (profile || (bot.tool && require('./terrain').isNatural({name:blockName}) && options.strategy !== 'branch')) return require('./branch-miner').runBranchMining(blockName, bot, state, config, count, options);
  if (options.strategy === 'branch' && !profile) throw new Error('分支矿道只适用于矿石，请为普通方块使用 nearby。');
  if (profile) blockName = profile.names.find(name => bot.registry.blocksByName[name]) || blockName;
  const definition = bot.registry.blocksByName[blockName];
  if (!definition) throw new Error(`无法识别方块：${blockName}`);
  if (!Number.isSafeInteger(count) || count < 0 || count > 256) throw new Error('挖掘数量必须是 0 到 256 的整数。');
  if (state._miningTask) throw new Error('已有挖掘任务正在执行，请先用 !stop。');
  if (!bot.collectBlock) throw new Error('收集插件未就绪。');
  pauseWanderingForCommand(bot, state);
  const task = {};
  const epoch = state._commandEpoch || 0;
  state._miningTask = task;
  state.mode = 'mining';
  const targetCount = count || Infinity;
  const skipped = new Set();
  let mined = 0;
  let failedAttempts = 0;
  const initialItems = bot.inventory.items().reduce((total, item) => total + item.count, 0);
  const started = Date.now();
  const key = position => `${position.x},${position.y},${position.z}`;
  const check = () => {
    if ((state._commandEpoch || 0) !== epoch || state.mode !== 'mining' || state._miningTask !== task) {
      const error = new Error('挖掘任务已停止');
      error.code = 'TASK_CANCELLED';
      throw error;
    }
    if (!bot.entity?.position || bot.health <= 0) throw new Error('机器人当前无法挖掘。');
  };
  const cancelCollection = () => {
    bot.pathfinder.setGoal(null);
    try { bot.stopDigging(); } catch (_) {}
    Promise.resolve(bot.collectBlock.cancelTask()).catch(error => console.log('[Miner] Cancel:', error.message));
  };
  try {
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    state._lastGotoTarget = null;
    // Keep the project's protected-block and terrain movement rules.
    bot.collectBlock.movements = bot.pathfinder.movements;
    while (mined < targetCount) {
      check();
      if (Date.now() - started > 240000) throw new Error(`挖掘任务超时，已挖 ${mined} 个 ${blockName}。`);
      state.currentTask = `挖掘 ${blockName} (${mined}/${count || '不限'})`;
      let positions = [];
      for (const maxDistance of [32, 64]) {
        positions = bot.findBlocks({
          matching: block => profile ? Boolean(block) && profile.names.includes(block.name) : block?.name === blockName,
          // This filter is called only on real blocks, never palette entries.
          useExtraInfo: block => Boolean(block?.position) && !skipped.has(key(block.position)) && (!profile ||
            require('./terrain').FACES.some(face => require('./terrain').isPassable(bot.blockAt(block.position.plus(face))))),
          maxDistance,
          count: profile ? 48 : 12,
        });
        if (positions.length) break;
      }
      if (!positions.length) {
        if (!count && mined) break;
        throw new Error(`附近没有可继续挖掘的 ${blockName}，已挖 ${mined}/${count || 0} 个。`);
      }
      const candidates = positions.map(position => bot.blockAt(position)).filter(block => block?.position && (profile ? profile.names.includes(block.name) : block.name === blockName));
      if (profile && bot.canDigBlock) candidates.sort((a,b)=>Number(bot.canDigBlock(b))-Number(bot.canDigBlock(a)));
      const block = candidates[0];
      if (!block) throw new Error('目标方块所在区块尚未加载，请稍后重试。');
      const positionKey = key(block.position);
      const originalName = block.name;
      const inventoryBefore = bot.inventory.items().reduce((total, item) => total + item.count, 0);
      try {
        if (profile && bot.tool) {
          const { canStand, breakRisk } = require('./terrain');
          const { navigateTo } = require('./navigation');
          if (breakRisk(bot,block)) throw new Error(`无法安全开采 ${block.name}。`);
          if (bot.canDigBlock && !bot.canDigBlock(block)) {
            const ground=[];
            const feet=bot.entity.position.floored();
            for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++)for(let dy=-2;dy<=2;dy++) {
              const point=feet.clone();point.x=block.position.x+dx;point.z=block.position.z+dz;point.y+=dy;
              if(canStand(bot,point)&&point.offset(.5,1.65,.5).distanceTo(block.position.offset(.5,.5,.5))<4.8)ground.push(point);
            }
            ground.sort((a,b)=>a.distanceTo(bot.entity.position)-b.distanceTo(bot.entity.position));
            if(!ground.length)throw Object.assign(new Error('矿石附近没有安全落脚点。'),{code:'ORE_UNREACHABLE'});
            let reached=false;
            for(const point of ground.slice(0,2)) {
              try {await navigateTo(point.x,point.y,point.z,bot,{state,assertActive:check,exact:true,range:0,timeout:12000,saveTrail:false});reached=bot.canDigBlock(block);}
              catch(error){check();}
              if(reached)break;
            }
            if(!reached)throw Object.assign(new Error('无法走到矿石的开采范围。'),{code:'ORE_UNREACHABLE'});
          }
          await require('./dig-confirmed').digConfirmed(bot,block,{state,assertActive:check,prepare:async()=>{
            await waitForAction(bot.tool.equipForBlock(block,{requireHarvest:true,getFromChest:false}),{assertActive:check,timeout:5000});
            if(block.canHarvest&&!block.canHarvest(bot.heldItem?.type??null))throw new Error('当前镐不能采集目标矿石。');
          }});
          if(bot.waitForTicks)await waitForAction(bot.waitForTicks(3),{assertActive:check,timeout:1000});
          await require('./item-pickup').collectNearbyItems(bot,{state,assertActive:check,radius:5,timeout:3000});
        } else await waitForAction(bot.collectBlock.collect(block, { append: false }), {
          assertActive: check,
          timeout: 30000,
          onInterrupt: cancelCollection,
        });
        check();
        const current = bot.blockAt(block.position);
        const inventoryAfter = bot.inventory.items().reduce((total, item) => total + item.count, 0);
        if (!current || current.name === originalName) throw new Error('目标方块没有成功挖下。');
        if (inventoryAfter <= inventoryBefore) throw new Error('方块已移除，但没有确认收到掉落物。');
        mined++;
        state.stats.blocksMined = (state.stats.blocksMined || 0) + 1;
        state.stats.itemsCollected = (state.stats.itemsCollected || 0) + inventoryAfter - inventoryBefore;
        console.log(`[Miner] Collected ${blockName} (${mined}/${count || '不限'}) at ${positionKey}`);
      } catch (error) {
        check();
        skipped.add(positionKey);
        if (error.code !== 'ORE_UNREACHABLE') failedAttempts++;
        console.log(`[Miner] Skipping ${positionKey}:`, error.message);
        if (failedAttempts >= 5) throw new Error(`已有 5 个方块无法挖掘或收集，已完成 ${mined} 个。最后错误：${error.message}`);
      }
    }
    const collected = bot.inventory.items().reduce((total, item) => total + item.count, 0) - initialItems;
    return { mined, collected, message: `已挖掘并收集 ${mined} 个 ${blockName}。` };
  } finally {
    if (state._miningTask === task) {
      state._miningTask = null;
      if ((state._commandEpoch || 0) === epoch) {
        state.mode = 'idle';
        state.currentTask = null;
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
      }
    }
  }
}

module.exports = { startMiner };
