const { Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');
const { waitForAction, pauseWanderingForCommand } = require('./task-control');
const { HAZARDS, vector, findSafeGround, standingPoint } = require('./terrain');
const { dimensionName } = require('./mining-plan');

function safeMovements(bot, options = {}) {
  const previous = bot.pathfinder.movements;
  const movements = new Movements(bot);
  for (const id of previous?.blocksCantBreak || []) movements.blocksCantBreak.add(id);
  for (const id of previous?.blocksToAvoid || []) movements.blocksToAvoid.add(id);
  movements.exclusionAreasBreak.push(...(previous?.exclusionAreasBreak || []));
  movements.exclusionAreasPlace.push(...(previous?.exclusionAreasPlace || []));
  for (const name of HAZARDS) {
    if (name === 'water' && options.avoidWater === false) continue;
    const block = bot.registry.blocksByName[name];
    if (block) movements.blocksToAvoid.add(block.id);
  }
  movements.canDig = options.canDig === true;
  movements.allow1by1towers = false;
  movements.allowParkour = false;
  movements.allowSprinting = false;
  // Pathfinder measures to the supporting block: one foot-level step needs 2.
  movements.maxDropDown = 2;
  movements.infiniteLiquidDropdownDistance = false;
  movements.dontCreateFlow = true;
  movements.dontMineUnderFallingBlock = true;
  movements.scafoldingBlocks = [];
  movements.liquidCost = 100;
  movements.exclusionAreasStep.push(block => HAZARDS.has(block.name) && !(block.name === 'water' && options.avoidWater === false) ? Infinity : 0);
  return movements;
}

function appendTrail(trail, point) {
  const value = { x: point.x, y: point.y, z: point.z };
  const index = trail.findIndex(old => old.x === value.x && old.y === value.y && old.z === value.z);
  if (index >= 0) trail.splice(index + 1);
  else trail.push(value);
  return trail;
}

function hasArrived(position, target, range = 0) {
  // Pathfinder goals operate on foot-level block cells, not distance to a cell's corner.
  const dx = Math.floor(position.x) - Math.floor(target.x);
  const dy = Math.floor(position.y) - Math.floor(target.y);
  const dz = Math.floor(position.z) - Math.floor(target.z);
  return dx * dx + dy * dy + dz * dz <= range * range;
}

function startNavigation(bot,goal) {
  if(typeof bot.pathfinder.getPathFromTo!=='function')return {promise:bot.pathfinder.goto(goal),cleanup:()=>{}};
  // The library's goto resolves on ANY empty path, including a provisional
  // A* tick. An empty partial result is not proof of arrival.
  let cleanup;
  const promise=new Promise((resolve,reject)=>{
    const finish=error=>{cleanup();error?reject(error):resolve();};
    const reached=completed=>{if(completed===goal)finish();};
    const update=result=>{if(result.status==='noPath'||result.status==='timeout')finish(new Error(`寻路计算失败：${result.status}`));};
    const changed=current=>{if(current!==goal)finish(new Error('导航目标在到达前被替换'));};
    const stopped=()=>finish(new Error('导航在到达前停止'));
    cleanup=()=>{bot.removeListener('goal_reached',reached);bot.removeListener('path_update',update);bot.removeListener('goal_updated',changed);bot.removeListener('path_stop',stopped);};
    bot.on('goal_reached',reached);bot.on('path_update',update);bot.on('goal_updated',changed);bot.on('path_stop',stopped);
    try{bot.pathfinder.setGoal(goal);}catch(error){finish(error);}
  });
  return {promise,cleanup};
}

async function navigateTo(x, y, z, bot, options = {}) {
  if (![x, y, z].every(Number.isFinite)) throw new Error('导航坐标必须是有效数字。');
  if (Math.abs(x) > 29999984 || Math.abs(z) > 29999984) throw new Error('目标坐标超出世界边界。');
  if (bot.game?.minY !== undefined && (y < bot.game.minY || y >= bot.game.minY + bot.game.height - 1)) throw new Error('目标 Y 超出当前维度的高度范围。');
  const state = options.state;
  if (state?._navigationTask) throw new Error('已有导航任务，请先停止。');
  const epoch = state?._commandEpoch || 0;
  const token = {};
  if (state) state._navigationTask = token;
  const origin = options.surface ? standingPoint(bot) : bot.entity.position.floored();
  const trail = [origin];
  const previous = bot.pathfinder.movements;
  const deadline = Date.now() + (options.timeout ?? 90000);
  const range = options.range ?? 1;
  const segmentSize = options.segmentSize ?? 12;
  const target = vector({ x, y, z });
  const footPosition = () => options.surface ? standingPoint(bot) : bot.entity.position;
  let lastFailure;
  const check = () => {
    options.assertActive?.();
    if (state && ((state._commandEpoch || 0) !== epoch || state._navigationTask !== token)) {
      const error = new Error('导航已停止'); error.code = 'TASK_CANCELLED'; throw error;
    }
    if (!bot.entity?.position || bot.health <= 0) throw new Error('机器人当前无法移动。');
    if (bot.health <= 6) throw new Error('生命值过低，停止探路。');
    if (Date.now() >= deadline) throw new Error('导航整体超时。');
  };
  try {
    const movements = options.movements || safeMovements(bot, options);
    if (bot.pathfinder.movements !== movements) bot.pathfinder.setMovements(movements);
    for (let segment = 0; segment < 128; segment++) {
      check();
      const current = bot.entity.position;
      if (hasArrived(footPosition(), target, range)) return { arrived: true, position: current.clone(), trail };
      const horizontal = Math.hypot(target.x - current.x, target.z - current.z);
      let waypoint;
      if (horizontal > segmentSize && options.exact !== true) {
        const fraction = segmentSize / horizontal;
        waypoint = findSafeGround(bot, current.x + (target.x - current.x) * fraction, current.z + (target.z - current.z) * fraction, current.y);
        if (!waypoint) throw new Error('前方没有已加载的安全落脚点，可能是水域、深坑或陡坡。');
      } else waypoint = target;
      let reached = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        check();
        let progressPosition = bot.entity.position.clone();
        let progressedAt = Date.now();
        const movingCheck = () => {
          check();
          if (bot.entity.position.distanceTo(progressPosition) > 0.5) {
            progressPosition = bot.entity.position.clone(); progressedAt = Date.now();
          }
          if (Date.now() - progressedAt > (options.stuckTimeout ?? 10000)) throw new Error('路线受阻，机器人持续无法前进。');
        };
        let action;
        try {
          action=startNavigation(bot,new GoalNear(waypoint.x, waypoint.y, waypoint.z, range));
          await waitForAction(action.promise, {
            assertActive: movingCheck,
            timeout: Math.min(options.segmentTimeout ?? 25000, deadline - Date.now()),
            onInterrupt: () => bot.pathfinder.setGoal(null),
          });
          check();
          if (!hasArrived(footPosition(), waypoint, range)) {
            throw new Error(`寻路结束，但没有实际到达落脚点：当前 ${bot.entity.position.floored()}，目标 ${vector(waypoint).floored()}。`);
          }
          reached = true;
          appendTrail(trail, bot.entity.position.floored());
          break;
        } catch (error) {
          check();
          lastFailure = error;
          bot.pathfinder.setGoal(null);
          console.log(`[Navigation] Replan ${attempt + 1}:`, error.message);
        } finally {action?.cleanup();}
      }
      if (!reached) throw lastFailure;
      if (bot.entity.position.floored().equals(origin) && segment > 1) throw new Error('导航没有取得进展。');
    }
    throw new Error('路线超过分段上限，请缩短目标距离。');
  } finally {
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    if (bot.pathfinder.movements !== previous) bot.pathfinder.setMovements(previous);
    if (state?._navigationTask === token) {
      state._navigationTask = null;
      if (options.saveTrail !== false && trail.length > 1) state._lastNavigationTrail = { dimension: dimensionName(bot.game?.dimension), points: trail };
    }
  }
}

async function returnAlongTrail(bot, state, options = {}) {
  const stored = state._lastExpeditionRoute || state._lastNavigationTrail;
  if (!stored?.points?.length) throw new Error('没有可回溯的路线。');
  if (stored.dimension !== dimensionName(bot.game?.dimension)) throw new Error('记录的路线属于其他维度。');
  if (stored.adaptive) {
    const points = stored.points.slice().reverse();
    const destination = points[points.length-1];
    return require('./journey').travelJourney(bot,state,global.config||{},{x:destination.x,y:destination.y,z:destination.z,waypoints:points,lead:false,label:'返程起点',exactFinish:true},options.assertActive);
  }
  const points = stored.points.slice().reverse();
  const epoch = state._commandEpoch || 0;
  const check = () => {
    options.assertActive?.();
    if ((state._commandEpoch || 0) !== epoch) { const error = new Error('返程已停止'); error.code = 'TASK_CANCELLED'; throw error; }
  };
  pauseWanderingForCommand(bot, state);
  state.mode = 'navigating'; state.currentTask = '沿记录路线返程';
  try {
    for (const point of points) {
      check();
      await navigateTo(point.x, point.y, point.z, bot, { state, assertActive: check, saveTrail: false, timeout: 30000, exact: true, range: 0 });
    }
    return { message: '已沿记录路线返回出发点。' };
  } finally {
    if ((state._commandEpoch || 0) === epoch) { state.mode = 'idle'; state.currentTask = null; }
  }
}

async function backtrack(bot, path, index = 0, options = {}) {
  for (const point of path.slice(index)) await navigateTo(point.x, point.y, point.z, bot, { ...options, saveTrail: false, exact: true });
}

module.exports = { navigateTo, safeMovements, appendTrail, returnAlongTrail, backtrack, hasArrived };
