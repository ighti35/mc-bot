const fs=require('fs'),path=require('path');
const {vector,isPassable,inspectTunnelStep}=require('./terrain');
const {resolvePlayer}=require('./player-targets');
const {waitForAction,pauseWanderingForCommand}=require('./task-control');
const {navigateTo,safeMovements}=require('./navigation');
function openToSky(bot,point){
  const top=(bot.game.minY??-64)+(bot.game.height??384);
  for(let y=point.y+1;y<top;y++){const block=bot.blockAt(vector(point).offset(0,y-point.y,0));if(!block||!isPassable(block))return false;}
  return true;
}
async function guideToSurface(bot,state,config){
  if(state._surfaceGuide)throw new Error('已经在带路。');
  if(!String(bot.game.dimension).includes('overworld'))throw new Error('这条返地面路线仅用于主世界。');
  pauseWanderingForCommand(bot,state);const epoch=state._commandEpoch||0,token={},position=bot.entity.position.floored(),saved=state._lastSurfaceRoute;
  const route=saved&&!saved.surface&&saved.points?.length&&vector(saved.points.at(-1)).equals(position)?saved.points.map(vector):[position],original=bot.pathfinder.movements;
  const visited=new Set(route.map(p=>p.toString()));let detours=0;
  state._surfaceGuide=token;state.mode='placing';state.currentTask='带主人返回地面';
  const active=()=>{if((state._commandEpoch||0)!==epoch||state._surfaceGuide!==token)throw Object.assign(new Error('地面带路已停止'),{code:'TASK_CANCELLED'});if(bot.health<=6)throw new Error('生命值过低，暂停带路。');};
  let reachedSurface=false;
  const save=()=>{state._lastSurfaceRoute={origin:route[0],points:route.map(p=>({x:p.x,y:p.y,z:p.z})),surface:reachedSurface};const dir=path.join(__dirname,'../data/surface-routes');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'latest.json'),JSON.stringify(state._lastSurfaceRoute,null,2));};
  const waitOwner=async()=>{let announced=false;while(true){active();const owner=resolvePlayer(bot,config.owner);if(owner&&owner.position.distanceTo(bot.entity.position)<=8)return;if(!announced){bot.chat('我在阶梯上等你，靠近到8格内后继续带路。');announced=true;}state.currentTask='返地面：等待主人跟上';await new Promise(r=>setTimeout(r,500));}};
  const move=async p=>{await navigateTo(p.x,p.y,p.z,bot,{state,assertActive:active,exact:true,range:0,timeout:15000,movements:safeMovements(bot)});route.push(bot.entity.position.floored());visited.add(bot.entity.position.floored().toString());};
  try{
    bot.pathfinder.setGoal(null);bot.clearControlStates();bot.chat('跟着我上去。我会修步行阶梯，距离超过8格就停下来等你；!stop 可以停止。');
    for(let step=0;step<600;step++){
      active();await waitOwner();const from=bot.entity.position.floored();
      if(openToSky(bot,from)){reachedSurface=true;save();bot.chat(`我们已回到露天地面 (${from.x},${from.y},${from.z})。`);return {surface:from};}
      state.currentTask=`返地面：向上开阶梯 Y=${from.y}`;let advanced=false;
      // Head west towards the original surface area; other directions bypass unsafe geology.
      for(const [dx,dz] of [[-1,0],[0,1],[0,-1],[1,0]]){
        const to=from.offset(dx,1,dz);let inspection=inspectTunnelStep(bot,from,to);
        if(!inspection.safe&&inspection.reason==='前方没有安全支撑，可能是深坑或液体'){
          const floor=to.offset(0,-1,0),preview=Object.create(bot);preview.blockAt=p=>p.equals(floor)?{name:'cobblestone',boundingBox:'block'}:bot.blockAt(p);
          if(inspectTunnelStep(preview,from,to).safe){
            const support=require('./mining-support');
            try{
              if(!await support.fillTunnelSupport(bot,to,active)){
                await support.fillTunnelSupport(bot,to.offset(0,-1,0),active);
                await support.fillTunnelSupport(bot,to,active);
              }
              inspection=inspectTunnelStep(bot,from,to);
            }catch(error){active();console.log('[Surface Guide] Support:',error.message);}
          }
        }
        if(!inspection.safe)continue;
        for(const block of inspection.blocks){active();await require('./dig-confirmed').digConfirmed(bot,block,{state,assertActive:active,prepare:async()=>{await waitForAction(bot.tool.equipForBlock(block,{requireHarvest:true,getFromChest:false}),{assertActive:active,timeout:5000});}});}
        try{await move(to);advanced=true;detours=0;break;}catch(error){active();console.log('[Surface Guide] Step failed:',error.message);}
      }
      if(!advanced&&detours<48){
        state.currentTask=`返地面：绕开矿井木梁 Y=${from.y}`;
        for(const [dx,dz] of [[-1,0],[1,0],[0,1],[0,-1]]){
          const to=from.offset(dx,0,dz);if(visited.has(to.toString()))continue;
          try{await require('./mining-support').fillTunnelSupport(bot,to,active);}catch(error){active();continue;}
          const inspection=inspectTunnelStep(bot,from,to);if(!inspection.safe)continue;
          for(const block of inspection.blocks)await require('./dig-confirmed').digConfirmed(bot,block,{state,assertActive:active,prepare:()=>waitForAction(bot.tool.equipForBlock(block,{requireHarvest:true,getFromChest:false}),{assertActive:active,timeout:5000})});
          try{await move(to);advanced=true;detours++;break;}catch(error){active();}
        }
      }
      if(!advanced)throw new Error(`Y=${from.y} 的四个上升方向都不安全，保留已修阶梯并暂停。`);
      if(step%8===0)save();
    }
    throw new Error('阶梯达到步数上限，已保存路线。');
  }finally{save();if(state._surfaceGuide===token){state._surfaceGuide=null;bot.pathfinder.setGoal(null);bot.clearControlStates();bot.pathfinder.setMovements(original);if((state._commandEpoch||0)===epoch){state.mode='idle';state.currentTask=null;}}}
}
module.exports={guideToSurface,openToSky};
