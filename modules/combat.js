// mc-bot/modules/combat.js — 自动反击模块
const { GoalNear } = require('mineflayer-pathfinder').goals;

let combatInterval = null;
let currentTarget = null;

/**
 * 启动战斗模块：监听受伤事件，自动反击
 */
function initCombat(bot, state, config) {
  const owner = config.owner;

  // 受伤时自动反击
  bot.on('entityHurt', (entity) => {
    // entityHurt: 表示 bot 对 entity 造成了伤害
    // 不是我们需要的，我们需要的是 bot 被攻击的事件
  });

  // 正确的 bot 被攻击事件是比较 health 下降
  // mineflayer 用 "health" 事件监听血量变化
  bot.on('health', () => {
    if (state.mode === 'combat') return; // 已经在战斗中
    if (state.mode === 'mining' || state.mode === 'collecting' || state.mode === 'chopping') return; // 工作时不触发
    if (bot.health <= 0) return;

    // 找最近攻击 bot 的敌对生物
    const attacker = findNearestHostile(bot, owner);
    if (!attacker) return;

    startCombat(bot, state, attacker);
  });

  // 周期性检查附近是否有敌对生物在攻击 bot
  combatInterval = setInterval(() => {
    if (state.mode === 'combat') return; // 已经在战斗
    if (state.mode === 'mining' || state.mode === 'collecting' || state.mode === 'enchanting' || state.mode === 'chopping') return; // 工作时不打扰
    if (bot.health <= 0) return;

    // 没武器时不主动出击（但会逃跑）
    if (!hasAnyWeapon(bot)) return;

    const hostile = findNearestAttackingHostile(bot, owner, 10);
    if (!hostile) return;

    startCombat(bot, state, hostile);
  }, 2000);
}

function findNearestHostile(bot, owner) {
  const pos = bot.entity.position;
  let closest = null;
  let closestDist = Infinity;

  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue;
    if (!isHostileMob(entity)) continue;
    // 排除 owner 玩家
    if (entity.username && entity.username === owner) continue;

    const dist = entity.position.distanceTo(pos);
    if (dist < 16 && dist < closestDist) {
      closest = entity;
      closestDist = dist;
    }
  }

  return closest;
}

function findNearestAttackingHostile(bot, owner, range) {
  const pos = bot.entity.position;
  let closest = null;
  let closestDist = Infinity;

  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue;
    if (!isHostileMob(entity)) continue;
    if (entity.username && entity.username === owner) continue;

    const dist = entity.position.distanceTo(pos);
    if (dist < range && dist < closestDist) {
      // 检查这个生物是否在看着 bot（表示它在攻击）
      closest = entity;
      closestDist = dist;
    }
  }

  return closest;
}

function startCombat(bot, state, target) {
  if (!target || !target.position) return;

  console.log(`[Combat] Engaging: ${target.name || target.username || target.mobType}`);
  state.mode = 'combat';
  state.currentTask = `Fighting ${target.name || target.username || 'mob'}`;
  currentTarget = target;

  // 装备最好的武器
  equipBestWeapon(bot);

  // 记录目标初始血量
  state._combatTargetId = target.id || target.uuid;
  state._combatTarget = target;

  fightTarget(bot, state, target);
}

function fightTarget(bot, state, target) {
  if (state.mode !== 'combat') return;
  if (!target || !target.isValid) {
    endCombat(state);
    return;
  }
  if (bot.health <= 5) {
    // 血量太低了，先跑
    bot.chat('Running away! Im too hurt!');
    state.mode = 'fleeing';
    const fleeX = bot.entity.position.x + (Math.random() - 0.5) * 20;
    const fleeZ = bot.entity.position.z + (Math.random() - 0.5) * 20;
    bot.pathfinder.setGoal(new GoalNear(fleeX, bot.entity.position.y, fleeZ, 1));
    setTimeout(() => {
      if (state.mode === 'fleeing') {
        state.mode = 'idle';
        state.currentTask = null;
        bot.chat('I retreated to safety.');
      }
    }, 5000);
    return;
  }

  // 追击超时检测：超过 25 秒还追不上就放弃
  const chaseStarted = state._combatChaseStarted || 0;
  if (chaseStarted === 0) {
    state._combatChaseStarted = Date.now();
  } else if (Date.now() - chaseStarted > 25000) {
    console.log('[Combat] 追击超时，放弃目标');
    bot.chat("Can't reach the target, giving up.");
    state._combatChaseStarted = 0;
    endCombat(state);
    return;
  }

  const dist = bot.entity.position.distanceTo(target.position);
  const weapon = bot.heldItem;

  if (dist > 3) {
    // 靠近目标
    bot.pathfinder.setGoal(new GoalNear(target.position.x, target.position.y, target.position.z, 2));
    currentTarget = target;
    setTimeout(() => {
      if (currentTarget === target && state.mode === 'combat') {
        fightTarget(bot, state, target);
      }
    }, 800);
    return;
  }

  // 进入攻击范围，重置追击计时
  state._combatChaseStarted = 0;

  // 在攻击范围内，看向并攻击
  bot.lookAt(target.position.offset(0, 1, 0));

  // 用剑攻击
  if (weapon && (weapon.name.includes('sword') || weapon.name.includes('axe'))) {
    bot.attack(target);
    // 连击
    setTimeout(() => {
      if (state.mode === 'combat' && currentTarget === target && target.isValid) {
        const d = bot.entity.position.distanceTo(target.position);
        if (d < 4.5) {
          bot.lookAt(target.position.offset(0, 1, 0));
          bot.attack(target);
        }
      }
    }, 600);
    setTimeout(() => {
      if (state.mode === 'combat' && currentTarget === target && target.isValid) {
        const d = bot.entity.position.distanceTo(target.position);
        if (d < 4.5) {
          bot.lookAt(target.position.offset(0, 1, 0));
          bot.attack(target);
        }
      }
    }, 1200);
  } else {
    // 没武器，空手打
    bot.attack(target);
  }

  // 3秒后检查目标是否还活着
  setTimeout(() => {
    if (state.mode === 'combat' && currentTarget === target) {
      if (!target.isValid) {
        endCombat(state);
        bot.chat(`Defeated ${target.name || 'the enemy'}!`);
        return;
      }
      // 继续追击
      fightTarget(bot, state, target);
    }
  }, 1500);
}

function endCombat(state) {
  state.mode = 'idle';
  state.currentTask = null;
  currentTarget = null;
  state._combatChaseStarted = 0;
}

function hasAnyWeapon(bot) {
  return bot.inventory.items().some((item) => {
    return item.name.includes('sword') || item.name.includes('_sword') ||
           item.name.includes('_axe') || item.name.includes('axe');
  });
}

function equipBestWeapon(bot) {
  // 优先剑，其次斧
  const weapons = bot.inventory.items().filter((item) => {
    return item.name.includes('sword') || item.name.includes('_sword') ||
           item.name.includes('_axe') || item.name.includes('axe');
  });

  if (weapons.length === 0) {
    console.log('[Combat] No weapon found, using fists');
    return;
  }

  // 按伤害排序
  const materialRank = { netherite: 5, diamond: 4, iron: 3, stone: 2, golden: 1, wooden: 1 };
  weapons.sort((a, b) => {
    const tierA = getMaterialRank(a.name, materialRank);
    const tierB = getMaterialRank(b.name, materialRank);
    if (tierB !== tierA) return tierB - tierA;
    // 剑优先于斧
    return (a.name.includes('sword') ? 1 : 0) - (b.name.includes('sword') ? 1 : 0);
  });

  const best = weapons[0];
  if (!bot.heldItem || bot.heldItem.type !== best.type) {
    bot.equip(best, 'hand').catch(() => {});
    console.log(`[Combat] Equipped: ${best.displayName || best.name}`);
  }
}

function getMaterialRank(name, rankMap) {
  for (const [mat, rank] of Object.entries(rankMap)) {
    if (name.includes(mat)) return rank;
  }
  return 0;
}

function isHostileMob(entity) {
  if (!entity || !entity.name) return false;

  const hostiles = [
    'zombie', 'skeleton', 'spider', 'cave_spider', 'creeper',
    'enderman', 'witch', 'slime', 'magma_cube', 'blaze',
    'ghast', 'wither_skeleton', 'stray', 'husk', 'drowned',
    'pillager', 'vindicator', 'evoker', 'ravager', 'vex',
    'phantom', 'guardian', 'elder_guardian', 'hoglin', 'piglin',
    'piglin_brute', 'zoglin', 'warden', 'endermite', 'silverfish',
    'shulker', 'illusioner', 'breeze', 'bogged',
  ];

  const name = (entity.name || '').toLowerCase();
  return hostiles.some(h => name.includes(h));
}

function stopCombat() {
  if (combatInterval) {
    clearInterval(combatInterval);
    combatInterval = null;
  }
  currentTarget = null;
}

module.exports = { initCombat, stopCombat, equipBestWeapon, hasAnyWeapon, startCombat };
