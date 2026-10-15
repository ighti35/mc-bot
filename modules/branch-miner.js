const fs = require('fs');
const path = require('path');
const { buildMiningPlan, nextStairPoint } = require('./mining-plan');
const { FACES, vector, isPassable, breakRisk, inspectTunnelStep } = require('./terrain');
const { navigateTo, safeMovements, appendTrail } = require('./navigation');
const { pauseWanderingForCommand, waitForAction } = require('./task-control');
const { collectNearbyItems } = require('./item-pickup');
const { scanTargets, planTargetTunnel } = require('./target-mining');

const pickaxeTier = name => ({ wooden: 1, golden: 1, stone: 2, iron: 3, diamond: 4, netherite: 5 })[name.split('_')[0]] || 0;
function usablePickaxe(bot, tier) {
  return bot.inventory.items().filter(item => item.name.endsWith('_pickaxe') && pickaxeTier(item.name) >= tier)
    .find(item => (bot.registry.itemsByName[item.name]?.maxDurability ?? Infinity) - (item.durabilityUsed || 0) > 8);
}

async function runBranchMining(input, bot, state, config = {}, count = 0, options = {}) {
  const plan = buildMiningPlan(bot, input, options);
  if (!Number.isSafeInteger(count) || count < 0 || count > 256) throw new Error('目标数量必须是 0 到 256 的整数。');
  if (state._miningTask) throw new Error('已有挖掘任务，请先用 !stop。');
  if (!plan.ordinary && !usablePickaxe(bot, plan.tier)) throw new Error(`开采${plan.label}需要${({ 1: '木镐', 2: '石镐', 3: '铁镐', 4: '钻石镐' })[plan.tier]}或更好的镐，并且耐久足够；请先把工具交给我。`);
  if (!bot.collectBlock || !bot.tool) throw new Error('挖掘或收集插件未就绪。');
  const targetCount = count || 16;
  const epoch = state._commandEpoch || 0;
  const token = {};
  const origin = bot.entity.position.floored();
  const route = [origin];
  const visited = new Map([[`${origin.x},${origin.y},${origin.z}`, origin]]);
  const originalMovements = bot.pathfinder.movements;
  const walkingMovements = safeMovements(bot);
  const skipped = new Set();
  const deferredTargets = new Map();
  const scanRadius = options.scanRadius ?? config.miningScanRadius ?? 32;
  if (!Number.isInteger(scanRadius) || scanRadius < 8 || scanRadius > 64) throw new Error('目标扫描半径必须为 8 到 64 格。');
  let pursuing = false;
  const deadline = Date.now() + (options.timeout ?? 20 * 60 * 1000);
  let mined = 0;
  let excavated = 0;
  let steps = 0;
  let returned = false;
  let failure;
  let returnError;
  pauseWanderingForCommand(bot, state);
  state._miningTask = token;
  state._strategyMiningTask = token;
  state.mode = 'mining';
  state._lastMiningPlan = { ...plan, origin: { x: origin.x, y: origin.y, z: origin.z }, targetCount, mined: 0, phase: '准备' };
  const key = point => `${point.x},${point.y},${point.z}`;
  const inventoryCount = () => bot.inventory.items().reduce((total, item) => total + item.count, 0);
  const active = () => {
    if ((state._commandEpoch || 0) !== epoch || state._miningTask !== token || state.mode !== 'mining') {
      const error = new Error('矿道任务已停止'); error.code = 'TASK_CANCELLED'; throw error;
    }
    if (!bot.entity?.position || bot.health <= 0) throw new Error('机器人当前无法挖矿。');
  };
  const safe = () => {
    active();
    if (Date.now() >= deadline) throw new Error('矿道任务达到时间上限。');
    if (bot.health <= 8 || bot.food <= 5) throw new Error('生命值或饱食度不足，停止开挖。');
    if (!plan.ordinary && !usablePickaxe(bot, plan.tier)) throw new Error('镐的耐久不足或工具丢失，停止开挖。');
    if ((bot.inventory.emptySlotCount?.() ?? Math.max(0, 36 - bot.inventory.items().length)) < 1) throw new Error('背包已满，停止开挖。');
  };
  const progress = phase => {
    state.currentTask = `${plan.label}矿道 Y=${plan.y} ${phase} (${mined}/${targetCount})`;
    Object.assign(state._lastMiningPlan, { phase, mined, excavated, steps });
  };
  const interrupt = () => {
    bot.pathfinder.setGoal(null);
    try { bot.stopDigging(); } catch (_) {}
    Promise.resolve(bot.collectBlock.cancelTask()).catch(error => console.log('[Branch] Cancel:', error.message));
  };
  const move = async point => {
    active();
    // Vein harvesting may remove the support of a previously recorded corridor cell.
    // Repair that nearby landing before asking the walking-only pathfinder to use it.
    if(bot.entity.position.distanceTo(vector(point))<=4){
      try{await require('./mining-support').fillTunnelSupport(bot,point,active);}
      catch(error){active();console.log('[Branch] Landing repair:',error.message);}
    }
    try {
      await navigateTo(point.x, point.y, point.z, bot, { state, assertActive: active, exact: true, range: 0, timeout: 15000, saveTrail: false, movements: walkingMovements });
    } catch(error) { active(); error.code ||= 'MINING_MOVE_FAILED';error.message+=`（目标 ${key(point)}）`; throw error; }
    active(); appendTrail(route, bot.entity.position.floored());
    visited.set(key(bot.entity.position.floored()), bot.entity.position.floored());
  };
  const collectDrops = async () => {
    active();
    await collectNearbyItems(bot, { state, assertActive: active, radius: 4, timeout: 2500 });
    appendTrail(route, bot.entity.position.floored());
  };
  const dig = async block => {
    safe();
    const current = bot.blockAt(block.position);
    if (!current || isPassable(current)) return;
    const risk = breakRisk(bot, current);
    if (risk) throw new Error(`停止开挖：${risk}。`);
    await require('./dig-confirmed').digConfirmed(bot,current,{state,assertActive:safe,prepare:async()=>{
      await waitForAction(bot.tool.equipForBlock(current, { requireHarvest: true, getFromChest: false, maxTools: 1 }), { assertActive: safe, timeout: 5000 });
      safe();
      if (current.canHarvest && !current.canHarvest(bot.heldItem?.type ?? null)) throw new Error(`当前工具不能采集 ${current.name}。`);
    }});
    active();
    const after = bot.blockAt(current.position);
    if (!after || after.name === current.name) throw new Error(`没有确认挖下 ${current.name}。`);
    excavated++;
    state.stats.blocksMined = (state.stats.blocksMined || 0) + 1;
    if (plan.names.includes(current.name)) mined++;
  };
  const harvestVein = async seed => {
    const queue = [seed.position];
    const beforeVein = inventoryCount();
    const beforeMined = mined;
    let examined = 0;
    while (queue.length && mined < targetCount && examined++ < 64) {
      safe();
      const position = queue.shift();
      if (skipped.has(key(position))) continue;
      const block = bot.blockAt(position);
      if (!block || !plan.names.includes(block.name)) continue;
      if (breakRisk(bot, block)) continue;
      try {
        if (bot.canDigBlock && !bot.canDigBlock(block)) continue;
        await dig(block);
        skipped.add(key(position));
        appendTrail(route, bot.entity.position.floored());
        for (const face of FACES) queue.push(position.plus(face));
        progress('追踪矿脉');
      } catch (error) {
        safe();
        console.log('[Branch] Vein block skipped:', error.message);
      }
    }
    if (mined > beforeMined) {
      if (bot.waitForTicks) await waitForAction(bot.waitForTicks(3), { assertActive: safe, timeout: 1000 });
      await collectDrops();
      state.stats.itemsCollected = (state.stats.itemsCollected || 0) + Math.max(0, inventoryCount() - beforeVein);
    }
  };
  const scanExposed = async () => {
    const positions = bot.findBlocks({
      matching: block => Boolean(block) && plan.names.includes(block.name),
      useExtraInfo: block => Boolean(block?.position) && !skipped.has(key(block.position)) &&
        FACES.some(face => isPassable(bot.blockAt(block.position.plus(face)))),
      maxDistance: 6, count: 48,
    });
    for (const position of positions) {
      if (mined >= targetCount) break;
      const block = bot.blockAt(position);
      if (block) await harvestVein(block);
    }
  };
  const torch = async previousPoint => {
    if (steps % 8 !== 0) return;
    const stack = bot.inventory.items().find(item => item.name === 'torch');
    if (!stack) return;
    const point = vector(previousPoint);
    if (bot.blockAt(point)?.name !== 'air') return;
    const ground = bot.blockAt(point.offset(0, -1, 0));
    if (ground?.boundingBox !== 'block') return;
    try {
      await waitForAction(bot.equip(stack, 'hand'), { assertActive: active, timeout: 5000 }); active();
      await waitForAction(bot.placeBlock(ground, vector({ x: 0, y: 1, z: 0 })), { assertActive: active, timeout: 5000 });
    } catch (error) { active(); console.log('[Branch] Torch:', error.message); }
  };
  const advance = async (from, to) => {
    safe();
    if (!bot.entity.position.floored().equals(vector(from))) await move(from);
    if (steps >= plan.maxSteps) throw new Error('矿道达到开挖步数上限。');
    let inspection = inspectTunnelStep(bot, from, to);
    if(!inspection.safe&&inspection.reason==='前方没有安全支撑，可能是深坑或液体'){
      // Validate the tunnel before placing a floor; never bridge into fluids or protected blocks.
      const floor=vector(to).offset(0,-1,0);
      const preview=Object.create(bot);
      preview.blockAt=position=>position.equals(floor)?{name:'cobblestone',boundingBox:'block'}:bot.blockAt(position);
      if(inspectTunnelStep(preview,from,to).safe){
        try{if(await require('./mining-support').fillTunnelSupport(bot,to,safe)){inspection=inspectTunnelStep(bot,from,to);state._lastMiningPlan.supportsPlaced=(state._lastMiningPlan.supportsPlaced||0)+1;}}
        catch(error){safe();console.log('[Branch] Support placement skipped:',error.message);}
      }
    }
    if (!inspection.safe) return { blocked: inspection.reason };
    for (const block of inspection.blocks) {
      await dig(block);
      if (mined >= targetCount) {
        if (bot.waitForTicks) await waitForAction(bot.waitForTicks(3), { assertActive: active, timeout: 1000 });
        await collectDrops(); return { goal: true };
      }
    }
    if (bot.entity.position.floored().distanceTo(vector(from)) > 1) await move(from);
    await move(to);
    steps++;
    // Walking already picks up corridor debris. Avoid detouring after every step.
    if (steps % 4 === 0) await collectDrops();
    await torch(from);
    await scanExposed();
    // Vein chasing may leave the corridor; return to its last planned point.
    if (mined < targetCount && !bot.entity.position.floored().equals(vector(to))) await move(to);
    if (!pursuing && steps % 4 === 0 && mined < targetCount) {
      await pursueTargets();
      if (mined < targetCount && !bot.entity.position.floored().equals(vector(to))) await move(to);
    }
    return { point: vector(to) };
  };
  const pursueTargets = async () => {
    pursuing = true;
    try {
      // Bound speculative targets per scan so an unreachable cluster cannot monopolize the task.
      for (let attempts = 0; attempts < 4 && mined < targetCount; attempts++) {
        safe();
        const excluded = new Set([...skipped,...[...deferredTargets].filter(([,at])=>excavated-at<8).map(([id])=>id)]);
        const targets = scanTargets(bot,plan.names,{radius:scanRadius,excluded});
        if (!targets.length) break;
        const target = targets[0];
        state._lastMiningPlan.lockedTarget = { x:target.x,y:target.y,z:target.z,name:bot.blockAt(target).name,status:'规划路线' };
        progress(`锁定目标 (${target.x},${target.y},${target.z})`);
        bot.chat(`发现${plan.label}目标 (${target.x},${target.y},${target.z})，开始定向开矿道。`);
        const blockedEdges = new Set();
        let reached = false, reason;
        for (let replan = 0; replan < 2 && mined < targetCount; replan++) {
          safe();
          state._lastMiningPlan.lockedTarget.replans = replan;
          if (replan) progress(`重新规划目标 (${target.x},${target.y},${target.z})`);
          if (!plan.names.includes(bot.blockAt(target)?.name)) { reached = true; break; }
          const result = await planTargetTunnel(bot,bot.entity.position.floored(),target,{assertActive:safe,blockedEdges});
          if (!result.path) { reason = result.reason; break; }
          state._lastMiningPlan.lockedTarget.status = '开挖';
          state._lastMiningPlan.lockedTarget.routeLength = result.path.length;
          let blocked = false;
          for (const next of result.path) {
            safe();
            if (!plan.names.includes(bot.blockAt(target)?.name)) { reached = true; break; }
            const from = bot.entity.position.floored();
            let step;
            try { step = await advance(from,next); }
            catch(error) { safe(); if(error.code!=='MINING_MOVE_FAILED')throw error;step={blocked:error.message}; }
            if (step.goal) { reached = true; break; }
            if (step.blocked) {
              blockedEdges.add(`${key(from)}>${key(next)}`);reason=step.blocked;blocked=true;break;
            }
          }
          if (reached || mined >= targetCount) break;
          if (!blocked) {
            const seed = bot.blockAt(target);
            if (seed && plan.names.includes(seed.name)) await harvestVein(seed);
            reached = !plan.names.includes(bot.blockAt(target)?.name);
            break;
          }
        }
        state._lastMiningPlan.lockedTarget.status = reached ? '已开采或目标已消失' : '暂时不可达';
        if (!reached) {
          deferredTargets.set(key(target),excavated);
          state._lastMiningPlan.lockedTarget.reason = reason || '目标暂时无法安全采集';
          console.log(`[Branch] Deferred ${key(target)}: ${state._lastMiningPlan.lockedTarget.reason}`);
        }
      }
    } finally { pursuing = false; }
  };
  const returnTo = async point => {
    const index = route.findIndex(saved => saved.x === point.x && saved.y === point.y && saved.z === point.z);
    if (index < 0) throw new Error('返程节点不在已记录的路线中。');
    const pathBack = route.slice(index).reverse();
    const returnDeadline = Date.now() + 120000;
    for (const saved of pathBack) {
      if (Date.now() > returnDeadline) throw new Error('返程达到时间上限，请使用 !back 继续。');
      await move(saved);
    }
  };
  try {
    bot.pathfinder.setGoal(null); bot.clearControlStates(); state._lastGotoTarget = null;
    bot.pathfinder.setMovements(walkingMovements);
    const localOnly = plan.ordinary || options.strategy === 'nearby' || options.strategy === 'targeted';
    bot.chat(`先扫描 ${scanRadius} 格内已加载的${plan.label}目标并定向开矿道${localOnly ? '' : `；没有目标时按 Y=${plan.y} 分支搜索`}。!stop 可停止。`);
    let current = origin;
    await scanExposed();
    await pursueTargets();
    if (localOnly && mined < targetCount) throw new Error(`已扫描附近 ${scanRadius} 格内加载的目标，完成 ${mined}/${targetCount}，没有更多可安全到达的目标。`);
    // An exploratory vein route may have reshaped the old corridor. Continue
    // descending from the actual safe position instead of forcing an early return.
    current=bot.entity.position.floored();
    let levelDetours=0;
    while (current.y !== plan.y && mined < targetCount) {
      progress('阶梯升降');
      let next;
      let reason;
      const directions = [plan.vector, { x: -plan.vector.z, z: plan.vector.x }, { x: plan.vector.z, z: -plan.vector.x },{x:-plan.vector.x,z:-plan.vector.z}];
      for (const direction of directions) {
        const candidate = nextStairPoint(current, plan.y, direction);
        let result;
        try{result=await advance(current,candidate);}catch(error){safe();if(error.code!=='MINING_MOVE_FAILED')throw error;result={blocked:error.message};}
        if (result.goal) break;
        if (result.point) { next = result.point; break; }
        reason = result.blocked;
      }
      if (mined >= targetCount) break;
      if(!next&&levelDetours<48){
        progress('洞穴横向绕行');
        for(const direction of directions){
          const candidate=current.offset(direction.x,0,direction.z);
          if(visited.has(key(candidate)))continue;
          let result;
          try{result=await advance(current,candidate);}catch(error){safe();if(error.code!=='MINING_MOVE_FAILED')throw error;result={blocked:error.message};}
          if(result.goal)break;
          if(result.point){next=result.point;levelDetours++;break;}
        }
      }
      if(mined>=targetCount)break;
      if (!next) throw new Error(`阶梯矿道无法安全继续：${reason}`);
      if(next.y!==current.y)levelDetours=0;
      current = next;
    }
    for (let distance = 1; distance <= plan.mainLength && mined < targetCount; distance++) {
      progress('主矿道');
      const next = current.offset(plan.vector.x, 0, plan.vector.z);
      const main = await advance(current, next);
      if (main.goal) break;
      if (!main.point) throw new Error(`主矿道受阻：${main.blocked}`);
      current = main.point;
      if (distance % plan.spacing !== 0) continue;
      const junction = current;
      for (const sign of [-1, 1]) {
        let branch = junction;
        for (let length = 0; length < plan.branchLength && mined < targetCount; length++) {
          progress(sign < 0 ? '左分支' : '右分支');
          const step = branch.offset(-plan.vector.z * sign, 0, plan.vector.x * sign);
          const result = await advance(branch, step);
          if (result.goal || !result.point) break;
          branch = result.point;
        }
        if (mined >= targetCount) break;
        await returnTo(junction);
      }
      current = junction;
    }
    if (mined < targetCount) throw new Error(`本轮矿道已搜索完成，挖到 ${mined}/${targetCount} 个目标矿石，可换方向继续。`);
  } catch (error) { failure = error; }
  finally {
    if (failure?.code !== 'TASK_CANCELLED' && (state._commandEpoch || 0) === epoch && bot.health > 6 && options.returnHome !== false) {
      try { progress('返程'); await returnTo(origin); returned = true; }
      catch (error) {
        console.log('[Branch] Return failed:', error.message);returnError=error.message;
        if(error.code==='TASK_CANCELLED'||(!failure&&mined<targetCount))failure=error;
      }
    }
    state._lastExpeditionRoute = { dimension: plan.dimension, points: route.map(point => ({ x: point.x, y: point.y, z: point.z })) };
    Object.assign(state._lastMiningPlan, { mined, excavated, steps, returned, returnError:returnError||null, phase: failure ? '已停止' : '完成', error: failure?.message || null });
    if (config.saveMiningRoutes !== false) {
      try {
        const directory = path.join(__dirname, '..', 'data', 'mining-routes');
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'latest.json'), JSON.stringify({ plan: state._lastMiningPlan, route: state._lastExpeditionRoute, surveyedPoints: [...visited.values()] }, null, 2));
      } catch (error) { console.log('[Branch] Route save:', error.message); }
    }
    if (state._miningTask === token) {
      state._miningTask = null; state._strategyMiningTask = null;
      bot.pathfinder.setMovements(originalMovements);
      if ((state._commandEpoch || 0) === epoch) { state.mode = 'idle'; state.currentTask = null; bot.pathfinder.setGoal(null); bot.clearControlStates(); }
    }
  }
  if (failure) throw failure;
  return { mined, excavated, returned, returnError, plan: state._lastMiningPlan, message: `本轮挖到 ${mined} 个${plan.label}矿石方块，开挖 ${excavated} 块地形${returned ? '，已返回出发点' : ''}。${returnError?`采矿已完成，返程暂未完成：${returnError}。我留在当前位置。`:''}` };
}

module.exports = { runBranchMining, usablePickaxe };
