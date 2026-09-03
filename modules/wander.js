// mc-bot/modules/wander.js — 自由漫游模块
const { GoalNear } = require('mineflayer-pathfinder').goals;
const Vec3 = require('vec3').Vec3;

let wanderInterval = null;
let centerPos = null;
let centerPlayer = null;
let currentWanderTarget = null;
let wanderTargetSetAt = 0;
let consecutiveWanderFails = 0;
let wanderPaused = false;
let pauseTimer = null;

/**
 * 开始漫游：以指定玩家为中心，在 wanderRadius 范围内随机走动
 */
function startWandering(bot, state, config, playerName) {
  stopWandering();

  if (!config.autoWander) return;

  centerPlayer = playerName || config.owner;
  const radius = config.wanderRadius || 32;
  state._wanderEnabled = true;
  consecutiveWanderFails = 0;
  wanderPaused = false;

  console.log(`[Wander] 开始漫游，中心玩家: ${centerPlayer}，半径: ${radius}`);

  wanderInterval = setInterval(() => {
    // 只在 idle 模式下漫游（chopping/navigating/mining/combat 等都不漫游）
    if (state.mode !== 'idle') return;
    if (!state._wanderEnabled) return;
    if (wanderPaused) return;

    // 更新中心位置（跟随玩家）
    const player = bot.players[centerPlayer]?.entity;
    if (player) {
      centerPos = player.position.clone();
    }

    if (!centerPos) return;

    // 如果已经在目标附近，生成新的随机目标
    const currentGoal = bot.pathfinder.goal;
    if (currentGoal && wanderTargetSetAt > 0) {
      const elapsed = Date.now() - wanderTargetSetAt;
      const goalPos = currentGoal instanceof GoalNear
        ? { x: currentGoal.x, y: currentGoal.y, z: currentGoal.z }
        : null;

      if (goalPos) {
        const dist = bot.entity.position.distanceTo(goalPos);

        // 还没走到，检查是否卡死
        if (dist > 1.5) {
          if (elapsed > 45000) {
            // 45秒还没走到 → 放弃这个目标
            console.log(`[Wander] 漫游目标超时 (${Math.round(elapsed/1000)}s)，放弃重选`);
            bot.pathfinder.setGoal(null);
            consecutiveWanderFails++;
            currentWanderTarget = null;
            wanderTargetSetAt = 0;

            if (consecutiveWanderFails >= 3) {
              console.log('[Wander] 连续3次漫游失败，暂停30秒');
              wanderPaused = true;
              bot.chat('漫游连续失败，暂停30秒');
              pauseTimer = setTimeout(() => {
                wanderPaused = false;
                consecutiveWanderFails = 0;
                console.log('[Wander] 恢复漫游');
              }, 30000);
            }
          }
          return; // 还没走到，继续等
        } else {
          // 到达了，重置失败计数
          if (consecutiveWanderFails > 0) {
            console.log('[Wander] 漫游恢复，重置失败计数');
          }
          consecutiveWanderFails = 0;
        }
      }
    }

    // 在 wanderRadius 范围内随机选点
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * radius * 0.8;
    const tx = centerPos.x + Math.cos(angle) * distance;
    const tz = centerPos.z + Math.sin(angle) * distance;

    // 找该 XZ 附近可站立的地面 Y
    const groundY = findGroundY(bot, tx, centerPos.y, tz);
    if (groundY === null) return;

    currentWanderTarget = { x: tx, y: groundY, z: tz };
    wanderTargetSetAt = Date.now();
    bot.pathfinder.setGoal(new GoalNear(tx, groundY, tz, 1));
  }, 3000);
}

function stopWandering() {
  if (wanderInterval) {
    clearInterval(wanderInterval);
    wanderInterval = null;
  }
  if (pauseTimer) {
    clearTimeout(pauseTimer);
    pauseTimer = null;
  }
  centerPos = null;
  centerPlayer = null;
  currentWanderTarget = null;
  wanderTargetSetAt = 0;
  consecutiveWanderFails = 0;
  wanderPaused = false;
}

/**
 * 在 (x, z) 附近找一个可以站立的 Y 坐标
 */
function findGroundY(bot, x, centerY, z) {
  for (let dy = 1; dy >= -10; dy--) {
    const y = Math.floor(centerY) + dy;
    const pos = new Vec3(Math.floor(x), y, Math.floor(z));
    const block = bot.blockAt(pos);
    const above = bot.blockAt(pos.offset(0, 1, 0));
    const below = bot.blockAt(pos.offset(0, -1, 0));

    if (!block || !above || !below) continue;

    const solidBelow = below.name !== 'air' && below.name !== 'water' && below.name !== 'lava';
    const airHere = block.name === 'air' || block.name === 'water';
    const airAbove = above.name === 'air' || above.name === 'water';

    if (solidBelow && airHere && airAbove) return y;
  }
  return null;
}

module.exports = { startWandering, stopWandering };
