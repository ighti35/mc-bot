const {goals:{GoalFollow}}=require('mineflayer-pathfinder');
const {safeMovements}=require('./navigation');
const {pauseWanderingForCommand,waitForAction}=require('./task-control');
const {resolvePlayer}=require('./player-targets');

function detectPlayerAttack(message,username){
  if(/不要|不许|不准|别打|为什么|怎么|是否|吗|能不能|[？?]/.test(message))return null;
  return /追杀我|攻击我|打我(?:\b|[，。！!]|$)|杀我|追我.*(?:打|攻击)|\b(?:kill|attack|hunt) me\b/i.test(message)?{player:username}:null;
}
async function huntPlayer(bot,state,config,args={},assertActive=()=>{}){
  if(!['idle','thinking','combat'].includes(state.mode)||state._playerCombatTask)throw new Error('已有任务，请先用 !stop。');
  const name=args.player||config.owner,duration=args.duration??300;
  if(!Number.isFinite(duration)||duration<1||duration>600)throw new Error('追击时长必须为 1 到 600 秒。');
  let target=resolvePlayer(bot,name);
  if(!target)throw new Error(`没有看到 ${name} 的实时玩家实体，不能按过期坐标攻击。`);
  const token={},epoch=state._commandEpoch||0,previous=bot.pathfinder.movements;
  let dead=false,hits=0,lastAttack=-Infinity,lastSeen=Date.now(),followed;
  const deadline=Date.now()+duration*1000;
  const death=entity=>{if(entity.id===target?.id||entity.uuid&&entity.uuid===target?.uuid)dead=true;};
  const check=()=>{assertActive();if((state._commandEpoch||0)!==epoch||state._playerCombatTask!==token)throw Object.assign(new Error('追击已停止'),{code:'TASK_CANCELLED'});if(bot.health<=4)throw new Error('生命值过低，停止追击。');};
  pauseWanderingForCommand(bot,state);state._playerCombatTask=token;state.mode='pursuing';
  bot.on('entityDead',death);
  try{
    const rank={netherite:6,diamond:5,iron:4,stone:3,golden:2,wooden:1};
    const weapons=bot.inventory.items().filter(item=>/_(sword|axe)$/.test(item.name));
    weapons.sort((a,b)=>(/_sword$/.test(b.name)?10:0)+(rank[b.name.split('_')[0]]||0)-(/_sword$/.test(a.name)?10:0)-(rank[a.name.split('_')[0]]||0));
    if(weapons[0])await waitForAction(bot.equip(weapons[0],'hand'),{assertActive:check,timeout:5000});
    bot.pathfinder.setMovements(safeMovements(bot,{avoidWater:false}));
    bot.chat(`开始追击并攻击 ${name}，不会在靠近后结束；!stop 停止。`);
    while(!dead&&Date.now()<deadline){
      check();
      const latest=resolvePlayer(bot,name);
      if(!latest){if(Date.now()-lastSeen>5000)throw new Error(`失去 ${name} 的实时视野，已停止追击。`);await new Promise(resolve=>setTimeout(resolve,100));continue;}
      target=latest;lastSeen=Date.now();
      const distance=target.position.distanceTo(bot.entity.position);
      state.currentTask=`追击 ${name}，距离 ${distance.toFixed(1)} 格，已攻击 ${hits} 次`;
      if(distance>2.6){if(followed!==target){bot.pathfinder.setGoal(new GoalFollow(target,2),true);followed=target;}}
      else{
        if(followed){bot.pathfinder.setGoal(null);followed=null;}
        const cooldown=/_axe$/.test(bot.heldItem?.name||'')?1100:/_sword$/.test(bot.heldItem?.name||'')?650:350;
        if(!bot.autoEat?.isEating&&Date.now()-lastAttack>=cooldown){
          check();await bot.lookAt(target.position.offset(0,1.4,0),true);check();
          if(resolvePlayer(bot,name)===target&&target.position.distanceTo(bot.entity.position)<=3){bot.attack(target);hits++;lastAttack=Date.now();}
        }
      }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    check();return {hits,message:dead?`目标 ${name} 已死亡，追击结束（攻击 ${hits} 次）。`:`追击时长结束，攻击 ${hits} 次；未确认击杀。`};
  }finally{
    bot.removeListener('entityDead',death);bot.pathfinder.setGoal(null);bot.clearControlStates();bot.pathfinder.setMovements(previous);
    if(state._playerCombatTask===token){state._playerCombatTask=null;if((state._commandEpoch||0)===epoch){state.mode='idle';state.currentTask=null;}}
  }
}
module.exports={huntPlayer,detectPlayerAttack};
