const fs=require('fs'),path=require('path');
const {Vec3}=require('vec3');
const {HAZARDS,FACES,canStand,isPassable,standingPoint,biomeName}=require('./terrain');
const {safeMovements,navigateTo,appendTrail}=require('./navigation');
const {pauseWanderingForCommand}=require('./task-control');
const {dimensionName}=require('./mining-plan');

const water=block=>['water','flowing_water','bubble_column'].includes(block?.name);
const dryHazards=new Set([...HAZARDS].filter(name=>name!=='water'));
function bridgeMaterials(bot) {
  return bot.inventory.items().filter(item=>/^(dirt|cobblestone|stone|deepslate|cobbled_deepslate|netherrack|tuff|granite|diorite|andesite)$|_planks$/.test(item.name) && bot.registry.blocksByName[item.name]?.boundingBox==='block');
}
function landingAt(bot,x,z,y) {
  const choices=[];
  for(let dy=12;dy>=-10;dy--) {
    const point=new Vec3(Math.floor(x),Math.floor(y)+dy,Math.floor(z));
    const feet=bot.blockAt(point),head=bot.blockAt(point.offset(0,1,0));
    if(!feet||!head)continue;
    let mode;
    if(canStand(bot,point))mode='walk';
    else if(water(feet)&&isPassable(head))mode='swim';
    if(mode&&FACES.every(face=>{const block=bot.blockAt(point.plus(face));return block&&!dryHazards.has(block.name);}))choices.push({point,mode,score:Math.abs(dy)});
  }
  choices.sort((a,b)=>a.score-b.score);
  if(choices.length)return choices[0];
  const point=new Vec3(Math.floor(x),Math.floor(y),Math.floor(z));
  if(isPassable(bot.blockAt(point))&&isPassable(bot.blockAt(point.offset(0,1,0)))&&isPassable(bot.blockAt(point.offset(0,-1,0))))return {point,mode:'gap'};
  return null;
}
function journeyCandidates(bot,map,target,{smallHill=4,maxBridgeSpan=24,bridgeBudget=64}={}) {
  const current=bot.entity.position,heading=Math.atan2(target.z-current.z,target.x-current.x);
  const remaining=Math.hypot(target.x-current.x,target.z-current.z);
  const materials=bridgeMaterials(bot),available=Math.min(bridgeBudget,materials.reduce((n,item)=>n+item.count,0));
  const candidates=[];const {cellKey,rememberCell}=require('./exploration');
  const columnCache=new Map();
  const sampleAt=(x,z)=>{const key=`${Math.floor(x)},${Math.floor(z)}`;if(!columnCache.has(key))columnCache.set(key,landingAt(bot,x,z,current.y));return columnCache.get(key);};
  const distances=[Math.min(12,Math.max(4,remaining)),8,4,Math.min(maxBridgeSpan,24)];
  for(const distance of [...new Set(distances)])for(const angle of [0,Math.PI/8,-Math.PI/8,Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2,3*Math.PI/4,-3*Math.PI/4,Math.PI]) {
    const x=current.x+Math.cos(heading+angle)*distance,z=current.z+Math.sin(heading+angle)*distance;
    const landing=sampleAt(x,z);
    const reject=reason=>rememberCell(map,{x,y:current.y,z},'blocked',reason);
    if(!landing||landing.mode==='gap'){reject('未知区块、悬崖没有对岸或危险地形');continue;}
    if(landing.point.y-current.y>smallHill){reject('山坡过高，尝试绕路');continue;}
    if(landing.point.distanceTo(current)<2)continue;
    const memory=map.cells[cellKey(landing.point)];
    if((memory?.visits||0)>=3 || (memory?.status==='blocked'&&Date.now()-memory.time<30000))continue;
    let gaps=0,wet=landing.mode==='swim',blocked=false;
    for(let step=1;step<distance;step++) {
      const fraction=step/distance;
      const sample=sampleAt(current.x+(landing.point.x-current.x)*fraction,current.z+(landing.point.z-current.z)*fraction);
      if(!sample||sample.point.y-current.y>smallHill){blocked=true;break;}
      if(sample.mode==='gap')gaps++;
      if(sample.mode==='swim')wet=true;
    }
    if(blocked){reject('前方高山或危险地形，需要绕行');continue;}
    if(gaps&&(wet||gaps>maxBridgeSpan||available<gaps)){reject('跨越悬崖的方块不足或跨度过长');continue;}
    const mode=gaps?'bridge':wet?'swim':'walk';
    if(distance>12&&mode!=='bridge')continue;
    const score=Math.hypot(target.x-landing.point.x,target.z-landing.point.z)+(memory?.visits||0)*24+Math.abs(landing.point.y-current.y)*2+Math.abs(target.y-landing.point.y)*.6+(mode==='swim'?2:mode==='bridge'?gaps*1.5:0);
    candidates.push({point:landing.point,mode,score,gaps});
  }
  candidates.sort((a,b)=>a.score-b.score);return candidates;
}
function journeyMovements(bot,mode,{smallHill=4,maxBridgeSpan=24,bridgeBudget=64,allowTower=false,targetY}={}) {
  const movements=safeMovements(bot,{avoidWater:false});
  const waterId=bot.registry.blocksByName.water?.id;
  if(waterId!==undefined)movements.blocksToAvoid.delete(waterId);
  const bubbleId=bot.registry.blocksByName.bubble_column?.id;if(bubbleId!==undefined)movements.blocksToAvoid.delete(bubbleId);
  movements.liquidCost=2;
  const start=standingPoint(bot);
  const tower=allowTower&&Number.isFinite(targetY)&&targetY>start.y&&mode==='bridge'&&bridgeBudget>0;
  const ceiling=tower?Math.max(start.y+smallHill,Math.min(Math.floor(targetY),start.y+bridgeBudget)):start.y+smallHill;
  movements.allow1by1towers=tower;
  // Native movement checks both the foot cell and the cell above the head.
  movements.exclusionAreasStep.push(block=>!block.position||block.position.y>ceiling+1?Infinity:0);
  movements.scafoldingBlocks=mode==='bridge'&&bridgeBudget>0?bridgeMaterials(bot).map(item=>item.type):[];
  const countScaffoldingItems=movements.countScaffoldingItems.bind(movements);
  const initialBlocks=countScaffoldingItems();
  movements.countScaffoldingItems=()=>{const available=countScaffoldingItems();return Math.max(0,Math.min(available,bridgeBudget-Math.max(0,initialBlocks-available)));};
  movements.exclusionAreasPlace.push(block=>{
    // Pathfinder passes the destination foot block, not the block to place.
    if(!block.position)return Infinity;
    const support=block.position.offset(0,-1,0);
    const validHeight=tower?support.y>=start.y-1&&support.y<ceiling:support.y===start.y-1;
    if(mode!=='bridge'||water(block)||!validHeight||Math.hypot(support.x-start.x,support.z-start.z)>maxBridgeSpan)return Infinity;
    return FACES.some(face=>{const adjacent=bot.blockAt(support.plus(face));return !adjacent||HAZARDS.has(adjacent.name);})?Infinity:0;
  });
  return movements;
}

async function travelJourney(bot,state,config={},args={},assertActive=()=>{}) {
  if(!['idle','thinking'].includes(state.mode)||state._explorationTask)throw new Error('已有任务，请先用 !stop。');
  if(![args.x,args.z].every(Number.isFinite)||Math.abs(args.x)>29999984||Math.abs(args.z)>29999984)throw new Error('带路目标坐标无效。');
  const smallHill=args.smallHill??4,maxBridgeSpan=args.maxBridgeSpan??24,bridgeLimit=args.bridgeLimit??64;
  const arrivalRange=args.arrivalRange??4;
  if(!Number.isFinite(arrivalRange)||arrivalRange<0||arrivalRange>8)throw new Error('到达范围必须为 0 到 8 格。');
  if(!Number.isInteger(smallHill)||smallHill<1||smallHill>8||!Number.isInteger(maxBridgeSpan)||maxBridgeSpan<1||maxBridgeSpan>48||!Number.isInteger(bridgeLimit)||bridgeLimit<0||bridgeLimit>256)throw new Error('地形路线参数无效。');
  const origin=standingPoint(bot),target=new Vec3(args.x,args.y??origin.y,args.z),dimension=dimensionName(bot.game?.dimension);
  const route=[origin],map={dimension,cells:{},landmarks:[]};state._explorationMap=map;
  const waypoints=(args.waypoints||[]).map(p=>new Vec3(p.x,p.y,p.z));
  const token={},epoch=state._commandEpoch||0,deadline=Date.now()+(args.timeout??30*60*1000);
  let walked=0,arrived=false,failure,usedBlocks=0;
  pauseWanderingForCommand(bot,state);state._explorationTask=token;state._journeyTask=token;state.mode='exploring';
  const check=()=>{
    assertActive();if((state._commandEpoch||0)!==epoch||state._explorationTask!==token){const error=new Error('带路已停止');error.code='TASK_CANCELLED';throw error;}
    if(bot.health<=8||bot.food<=5)throw new Error('生命值或饱食度不足，停止带路。');
    if(Date.now()>=deadline)throw new Error('带路达到时间上限，已保存路线。');
  };
  const ownerWait=async()=>{
    if(!args.lead||!config.owner)return;
    const waitingUntil=Date.now()+120000;let announced=false;
    while(true){check();const owner=bot.players?.[config.owner]?.entity;
      if(!owner)throw new Error('找不到主人，请回到机器人附近再继续带路。');
      if(owner.position.distanceTo(bot.entity.position)<=20)return;
      if(!announced){const p=bot.entity.position.floored();bot.chat(`我在 (${p.x},${p.y},${p.z}) 等你跟上。`);announced=true;}
      state.currentTask='带路：等待主人跟上';if(Date.now()>waitingUntil)throw new Error('等待主人跟上超时，已保存路线。');
      await new Promise(resolve=>setTimeout(resolve,250));
    }
  };
  try {
    bot.chat(`开始前往${args.label||'目标'} (${args.x},${args.z})：小坡翻越、高山绕行、水域游泳、悬崖搭路。!stop 停止。`);
    for(let segment=0;segment<2048;segment++) {
      check();await ownerWait();
      if(args.getTarget){
        const latest=args.getTarget();
        if(!latest||![latest.x,latest.y,latest.z].every(Number.isFinite))throw new Error('目标玩家已不在可见范围，停止追踪。');
        target.set(latest.x,latest.y,latest.z);args.targetY=latest.y;
      }
      const {rememberCell,observeLandmarks}=require('./exploration');
      rememberCell(map,bot.entity.position,'visited');observeLandmarks(bot,map);
      while(waypoints.length&&Math.hypot(waypoints[0].x-bot.entity.position.x,waypoints[0].z-bot.entity.position.z)<3)waypoints.shift();
      const destination=waypoints[0]||target;
      const horizontal=Math.hypot(target.x-bot.entity.position.x,target.z-bot.entity.position.z);
      if(!waypoints.length&&horizontal<=arrivalRange&&(args.targetY===undefined||Math.abs(bot.entity.position.y-args.targetY)<=1.5)) {
        if(args.exactFinish&&!standingPoint(bot).equals(target.floored())) {
          const before=bot.entity.position.clone();
          await navigateTo(target.x,target.y,target.z,bot,{state,assertActive:check,movements:journeyMovements(bot,'walk',{smallHill,maxBridgeSpan,bridgeBudget:0}),surface:true,exact:true,range:0,timeout:Math.min(10000,deadline-Date.now()),saveTrail:false});
          walked+=bot.entity.position.distanceTo(before);appendTrail(route,standingPoint(bot));
        }
        if(args.biome&&map.biome!==args.biome) {
          const nearby=[];
          for(let dx=-4;dx<=4;dx++)for(let dz=-4;dz<=4;dz++){
            const landing=landingAt(bot,target.x+dx,target.z+dz,bot.entity.position.y);
            if(!landing||landing.mode==='gap')continue;
            const b=bot.blockAt(landing.point);
            if(biomeName(bot,b)===args.biome)nearby.push(landing);
          }
          nearby.sort((a,b)=>a.point.distanceTo(bot.entity.position)-b.point.distanceTo(bot.entity.position));
          if(!nearby.length)throw new Error(`已到定位坐标附近，但当前群系是 ${map.biome}，尚未确认进入 ${args.biome}。目标可能在不同高度。`);
          const landing=nearby[0];
          await navigateTo(landing.point.x,landing.point.y,landing.point.z,bot,{state,assertActive:check,movements:journeyMovements(bot,landing.mode,{smallHill,maxBridgeSpan,bridgeBudget:0}),surface:true,exact:true,range:0,timeout:Math.min(15000,deadline-Date.now()),saveTrail:false});
          observeLandmarks(bot,map);appendTrail(route,standingPoint(bot));
          if(map.biome!==args.biome)throw new Error('尚未确认进入目标群系，停止报告到达。');
        }
        arrived=true;break;
      }
      state.currentTask=`带路${args.label||''}，剩余约 ${Math.round(horizontal)} 格`;
      const movements=journeyMovements(bot,'bridge',{smallHill,maxBridgeSpan,bridgeBudget:Math.max(0,bridgeLimit-usedBlocks),allowTower:args.allowTower===true,targetY:args.targetY});
      const highTarget=args.allowTower===true&&args.targetY>bot.entity.position.y+smallHill&&!waypoints.length;
      // Approach the platform first, then search a local volume for the ascent.
      // Searching every ground cell before a costly 40-block tower wastes the
      // entire A* budget, despite a valid column immediately beside the player.
      if(highTarget&&horizontal>12)movements.allow1by1towers=false;
      if(highTarget&&horizontal<=12){
        const center=standingPoint(bot),radius=Math.max(8,Math.ceil(horizontal)+2);
        movements.exclusionAreasStep.push(block=>!block.position||Math.hypot(block.position.x-center.x,block.position.z-center.z)>radius?Infinity:0);
      }
      const planned=await require('./journey-planner').planJourney(bot,map,destination,movements,{targetY:waypoints.length||highTarget&&horizontal>12?undefined:args.targetY,searchRadius:highTarget&&horizontal<=12?Math.max(8,Math.ceil(horizontal)+2):96,range:Math.max(0,arrivalRange-1)},check);
      state._journeyPlan=planned?{status:planned.status,cost:planned.cost,visitedNodes:planned.visitedNodes,path:planned.path}:null;
      if(!planned)rememberCell(map,destination,'blocked','已加载地形中没有找到可安全推进的路线');
      // A failed terrain search must not fall back to choosing attractive but
      // unreachable bearings; that was the source of repeated circles.
      const candidates=planned?[planned]:[];
      let progressed=false;
      for(const candidate of candidates.slice(0,6)) {
        check();const previous=bot.entity.position.clone();
        const inventoryBefore=bridgeMaterials(bot).reduce((n,i)=>n+i.count,0);
        try {
          state.currentTask=`带路：${({walk:'翻越小坡/绕山',swim:'游泳过水域',bridge:'用背包方块搭路'})[candidate.mode]}，剩余约 ${Math.round(horizontal)} 格`;
          const movements=candidate.movements||journeyMovements(bot,candidate.mode,{smallHill,maxBridgeSpan,bridgeBudget:bridgeLimit-usedBlocks});
          const movingCheck=()=>{
            check();
            if(args.getTarget){const latest=args.getTarget();if(!latest||target.distanceTo(latest)>3){const error=new Error('玩家位置变化，重新规划');error.code='TARGET_MOVED';throw error;}}
          };
          await navigateTo(candidate.point.x,candidate.point.y,candidate.point.z,bot,{state,assertActive:movingCheck,movements,surface:true,exact:true,range:candidate.mode==='swim'?1:0,segmentTimeout:candidate.mode==='bridge'?60000:25000,timeout:Math.min(candidate.mode==='bridge'?60000:25000,deadline-Date.now()),saveTrail:false});
          check();walked+=bot.entity.position.distanceTo(previous);appendTrail(route,standingPoint(bot));
          rememberCell(map,bot.entity.position,'visited');progressed=true;break;
        } catch(error) {check();appendTrail(route,standingPoint(bot));if(error.code==='TARGET_MOVED'){progressed=true;break;}rememberCell(map,candidate.point,'blocked',error.message);}
        finally {usedBlocks+=Math.max(0,inventoryBefore-bridgeMaterials(bot).reduce((n,i)=>n+i.count,0));}
      }
      if(!progressed){
        const rise=Math.ceil((args.targetY??bot.entity.position.y)-bot.entity.position.y);
        const supplies=Math.min(bridgeLimit-usedBlocks,bridgeMaterials(bot).reduce((n,item)=>n+item.count,0));
        if(rise>smallHill&&!args.allowTower)throw new Error(`目标比我高 ${rise} 格，当前任务不允许垫高；没有找到步行路线。已保存返程路线。`);
        if(rise>supplies&&args.allowTower)throw new Error(`目标还高 ${rise} 格，剩余搭路预算/方块只有 ${supplies} 个，无法继续安全垫高。已保存返程路线。`);
        throw new Error('前方路线均受阻：已加载地形中没有找到可执行路线，可能是空间、危险方块或落脚点受阻。已保存返程路线。');
      }
    }
    if(!arrived)throw new Error('带路达到分段上限，已保存路线。');
  } catch(error){failure=error;}
  finally {
    appendTrail(route,standingPoint(bot));
    state._lastExpeditionRoute={dimension,adaptive:true,points:route};
    state._lastExplorationResult={origin,target,walked:Math.round(walked),arrived,bridgeBlocks:usedBlocks,biome:map.biome,landmarks:map.landmarks.slice(-16),error:failure?.message||null};
    if(config.saveExplorationRoutes!==false){try{const directory=path.join(__dirname,'..','data','exploration');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'latest.json'),JSON.stringify({result:state._lastExplorationResult,route:state._lastExpeditionRoute,map},null,2));}catch(error){console.log('[Journey] Route save:',error.message);}}
    if(state._explorationTask===token){state._explorationTask=null;state._journeyTask=null;if((state._commandEpoch||0)===epoch&&state.mode==='exploring'){state.mode='idle';state.currentTask=null;}}
    bot.pathfinder.setGoal(null);bot.clearControlStates();
  }
  if(failure)throw failure;
  return {...state._lastExplorationResult,message:`已到达${args.label||'探路目标'}附近，记录约 ${Math.round(walked)} 格路线，搭路使用 ${usedBlocks} 个方块。!back 可返程。`};
}

module.exports={travelJourney,journeyCandidates,journeyMovements,landingAt,bridgeMaterials};
