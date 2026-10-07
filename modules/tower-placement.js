const {isPassable}=require('./terrain');

function waitForClearance(bot,reference,check,timeout=1500) {
  return new Promise((resolve,reject)=>{
    let timer;
    const cleanup=()=>{clearTimeout(timer);bot.removeListener('physicsTick',tick);};
    const tick=()=>{
      try{
        check();
        const p=bot.entity.position;
        if(Math.floor(p.x)!==reference.position.x||Math.floor(p.z)!==reference.position.z)throw new Error('垫高时离开了支撑柱，重新规划');
        // The new cube occupies [reference.y+1, reference.y+2]. Merely
        // leaving the ground is insufficient: the player's feet must clear it.
        if(p.y>=reference.position.y+2+.01){cleanup();resolve();}
      }catch(error){cleanup();reject(error);}
    };
    bot.on('physicsTick',tick);
    timer=setTimeout(()=>{cleanup();reject(new Error('跳跃未腾出放块空间，停止本次垫高'));},timeout);
    tick();
  });
}

function installTowerPlacement(bot,state) {
  if(bot._towerPlacementInstalled)return;
  const original=bot.placeBlock;
  bot.placeBlock=async function(reference,face) {
    const p=bot.entity?.position,token=state._journeyTask;
    const tower=token&&bot.pathfinder?.movements?.allow1by1towers&&face.x===0&&face.y===1&&face.z===0
      &&p&&Math.floor(p.x)===reference.position.x&&Math.floor(p.z)===reference.position.z
      &&p.y>=reference.position.y+1&&p.y<reference.position.y+2.5;
    if(!tower||typeof bot._placeBlockWithOptions!=='function')return original.call(bot,reference,face);
    const epoch=state._commandEpoch||0;
    const startedAt=Date.now();
    const check=()=>{
      if(state._journeyTask!==token||(state._commandEpoch||0)!==epoch||state._gameInventoryTask||state._inventoryTask){const error=new Error('垫高已停止');error.code='TASK_CANCELLED';throw error;}
      if(bot.health<=0)throw new Error('机器人当前无法垫高');
    };
    check();
    const destination=reference.position.plus(face);
    if(!isPassable(bot.blockAt(destination))||!isPassable(bot.blockAt(destination.offset(0,1,0)))||!isPassable(bot.blockAt(destination.offset(0,2,0))))throw new Error('垫高上方空间不足');
    // Aim before waiting for the jump apex, rather than rotating slowly during
    // the short placement window. Mineflayer still awaits the server block update.
    await bot.lookAt(reference.position.offset(.5,1,.5),true);
    check();
    await waitForClearance(bot,reference,check);
    check();
    const result=await bot._placeBlockWithOptions(reference,face,{forceLook:true,swingArm:'right'});
    const stats=state._towerPlacementStats||{placed:0,totalMs:0,lastMs:0};
    stats.placed++;stats.lastMs=Date.now()-startedAt;stats.totalMs+=stats.lastMs;state._towerPlacementStats=stats;
    return result;
  };
  bot._towerPlacementInstalled=true;
}

module.exports={installTowerPlacement};
