const {pauseWanderingForCommand}=require('./task-control');
const {Vec3}=require('vec3');
const permissions=require('./command-permissions');

function enabled(config={},message='',state,bot) {
  if(permissions.denied(message)||permissions.restricted(state))return false;
  return permissions.creative(bot,state)||permissions.active(state)||permissions.allows(message)||config.commandsRequireAuthorization!==true&&config.autoCommandFallback===true;
}
function keysOf(message){
  const keys=[];
  const visit=node=>{if(!node||typeof node!=='object')return;if(node.translate)keys.push(node.translate);for(const child of [...(node.with||[]),...(node.extra||[])])visit(child);};
  visit(message?.json||message);return keys;
}
function commandReply(message,position,root) {
  if(position!=='system'&&position!==1)return null;
  const keys=keysOf(message),text=typeof message==='string'?message:message?.toString?.()||'';
  if(root==='forceload'||root==='execute'){
    if(root==='execute'&&keys.includes('commands.execute.conditional.pass'))return {success:true,text,matched:true};
    if(root==='execute'&&keys.includes('commands.execute.conditional.fail'))return {success:true,text,matched:false};
    if(keys.includes('commands.forceload.query.failure'))return {success:true,text,forced:false};
    if(keys.includes('commands.forceload.query.success'))return {success:true,text,forced:true};
    if(keys.some(key=>/^commands\.forceload\.added\.(?:single|multiple)$/.test(key)))return {success:true,text,added:true};
    if(keys.includes('commands.forceload.added.failure'))return {success:true,text,added:false};
    if(keys.some(key=>/^commands\.forceload\.removed\.(?:single|multiple|failure)$/.test(key)))return {success:true,text};
  }
  if(keys.includes('argument.pos.unloaded')||/That position is not loaded/.test(text))return {error:text||'目的地区块未加载',code:'COMMAND_CHUNK_UNLOADED'};
  if(keys.includes('commands.setblock.failed')||keys.includes('commands.fill.failed'))return {error:text||'没有方块发生变化',code:'COMMAND_NO_CHANGE'};
  if(keys.some(key=>/^(?:commands\.generic|command\.unknown|argument\.|parsing\.)/.test(key)&&!/success/.test(key))||keys.some(key=>/^commands\./.test(key)&&/permission|not.?found|invalid|failed|failure|incomplete|unknown|no_players|no_entity|no_recipient/.test(key))||/没有权限|未知或不完整|Unknown or incomplete|not permitted|permission denied/i.test(text))return {error:text||keys.join(',')};
  const family=root==='tp'?'teleport':root;
  const relevant=keys.some(key=>key.startsWith(`commands.${family}.`)||root==='execute'&&/^commands\.(?:teleport|setblock|give|execute)\./.test(key));
  if(relevant&&keys.some(key=>/success|\.set$|\.query$/.test(key))){
    const count=(message?.json||message)?.with?.[0];
    const changed=Number(typeof count==='object'?count?.text:count);
    return {success:true,text,...(root==='fill'&&Number.isInteger(changed)?{changed}:{})};
  }
  return null;
}
async function runCommand(bot,state,command,{assertActive=()=>{},verify,timeout=8000,allowedModes=['idle','thinking']}={}) {
  if(typeof command!=='string'||/[\r\n]/.test(command)||!/^\/?(?:minecraft:)?[a-z_]+(?:\s|$)/.test(command.trim()))throw new Error('需要有效的单条 Minecraft 指令。');
  command='/'+command.trim().replace(/^\//,'');
  permissions.requireAllowed(bot,state,command);
  if(command.length>256)throw new Error('指令超过游戏长度限制。');
  if(state._commandTask||!allowedModes.includes(state.mode))throw new Error('已有任务，请先用 !stop。');
  const root=command.slice(1).split(/\s/)[0].replace(/^minecraft:/,'');
  if(!verify){
    const give=command.match(/^\/(?:minecraft:)?give\s+(?:@s|[A-Za-z0-9_]+)\s+(?:minecraft:)?([a-z0-9_]+)(?:\s+(\d+))?$/);
    const tp=command.match(/^\/(?:minecraft:)?(?:tp|teleport)\s+@s\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);
    if(give&&['@s',bot.username].includes(command.split(/\s+/)[1])){const before=itemCount(bot,give[1]),count=Number(give[2]||1);verify=()=>itemCount(bot,give[1])>=before+count;}
    if(tp){const target=new Vec3(Number(tp[1]),Number(tp[2]),Number(tp[3]));verify=()=>bot.entity.position.distanceTo(target)<=2;}
  }
  const token={},epoch=state._commandEpoch||0,previous=state.mode,previousTask=state.currentTask;
  pauseWanderingForCommand(bot,state);state._commandTask=token;state.mode=previous==='building'?'building':'thinking';state.currentTask=`执行指令：${root}`;
  let onMessage,timer,poll;
  const check=()=>{assertActive();permissions.requireAllowed(bot,state,command);if((state._commandEpoch||0)!==epoch||state._commandTask!==token)throw Object.assign(new Error('指令任务已停止'),{code:'TASK_CANCELLED'});if(bot._client&&bot._client.state!=='play')throw new Error('连接已断开，指令结果未确认。');};
  try{
    return await new Promise((resolve,reject)=>{
      let finished=false,feedback='',response;
      let initiallySatisfied=false;
      try{initiallySatisfied=Boolean(verify&&verify());}catch(error){reject(error);return;}
      const complete=(error)=>{if(finished)return;finished=true;error?reject(error):resolve({command,verified:true,feedback,response,message:`已确认指令执行：${command}`});};
      const inspect=()=>{try{check();if(verify&&verify()&&(!initiallySatisfied||feedback))complete();}catch(error){complete(error);}};
      onMessage=(message,position)=>{
        if(finished)return;
        const reply=commandReply(message,position,root);
        if(reply){try{check();}catch(error){error.commandResponse=reply;complete(error);return;}}
        if(reply?.error)complete(Object.assign(new Error(`服务器拒绝指令：${reply.error}`),{code:reply.code}));
        else if(reply?.success){feedback=reply.text;response=reply;if(!verify)complete();else inspect();}
      };
      bot.on('message',onMessage);
      timer=setTimeout(()=>complete(new Error('未确认指令执行结果，停止重试以避免重复添加或传送。')),timeout);
      poll=setInterval(inspect,50);
      try{check();bot.chat(command);inspect();}catch(error){complete(error);}
    });
  }finally{clearTimeout(timer);clearInterval(poll);if(onMessage)bot.removeListener('message',onMessage);if(state._commandTask===token){state._commandTask=null;if((state._commandEpoch||0)===epoch){state.mode=previous;state.currentTask=previous==='building'?previousTask:null;}}}
}
const itemCount=(bot,item)=>bot.inventory.items().filter(stack=>stack.name===item).reduce((total,stack)=>total+stack.count,0);
function itemFor(action,bot,message='') {
  const args=action.args||{};
  let name=String(args.item||args.block||(action.tool==='chop_tree'?'oak_log':'')).replace(/^minecraft:/,'');
  if(/_ore$/.test(name)&&!/(?:矿石|ore\b)/i.test(message)){
    name=name.replace(/^deepslate_/,'');
    name=({diamond_ore:'diamond',emerald_ore:'emerald',coal_ore:'coal',iron_ore:'raw_iron',copper_ore:'raw_copper',gold_ore:'raw_gold',redstone_ore:'redstone',lapis_ore:'lapis_lazuli',nether_quartz_ore:'quartz',nether_gold_ore:'gold_nugget'})[name]||name;
  }
  return bot.registry.itemsByName?.[name]?.name||null;
}
function playerName(name){if(!/^[A-Za-z0-9_]{1,16}$/.test(name||''))throw new Error('目标玩家名称无效。');return name;}
async function teleport(bot,state,config,target,check){
  if(typeof target==='string'){
    const name=playerName(target),visible=()=>bot.players?.[name]?.entity;
    return runCommand(bot,state,`/tp @s ${name}`,{assertActive:check,verify:visible()?()=>Boolean(visible()&&bot.entity.position.distanceTo(visible().position)<=3):undefined});
  }
  if(!target||![target.x,target.y,target.z].every(Number.isFinite)||Math.abs(target.x)>29999984||Math.abs(target.z)>29999984)throw new Error('没有可验证的传送目标。');
  return runCommand(bot,state,`/tp @s ${target.x} ${target.y} ${target.z}`,{assertActive:check,verify:()=>bot.entity.position.distanceTo(new Vec3(target.x,target.y,target.z))<=2});
}
async function giveMissing(bot,state,item,count,check){
  if(!item||!Number.isSafeInteger(count)||count<0||count>2304)throw new Error('无法确定有效的补充物品或数量。');
  if(!count)return;
  const before=itemCount(bot,item);
  return runCommand(bot,state,`/give @s minecraft:${item} ${count}`,{assertActive:check,verify:()=>itemCount(bot,item)>=before+count});
}
async function surfaceTeleportCommands(bot,state,target,check,options) {
  if(!target||![target.x,target.z].every(Number.isFinite)||Math.abs(target.x)>29999984||Math.abs(target.z)>29999984)throw new Error('目的地坐标无效。');
  const x=Math.floor(target.x),z=Math.floor(target.z);
  const command=`/execute positioned ${x+.5} 0 ${z+.5} positioned over motion_blocking_no_leaves run tp @s ~ ~ ~`;
  const attempt=()=>runCommand(bot,state,command,{assertActive:check,verify:()=>Math.hypot(bot.entity.position.x-(x+.5),bot.entity.position.z-(z+.5))<=2});
  try{return await attempt();}catch(error){if(error.code!=='COMMAND_CHUNK_UNLOADED')throw error;}
  check();
  let added=false;
  try{
    const status=await runCommand(bot,state,`/forceload query ${x} ${z}`,{assertActive:check});
    if(!status.response?.forced){
      try{const loading=await runCommand(bot,state,`/forceload add ${x} ${z}`,{assertActive:check});added=loading.response?.added===true;}
      catch(error){added=error.commandResponse?.added===true;throw error;}
    }
    const deadline=Date.now()+(options.loadTimeout??20000);
    // Server chunk generation is asynchronous even after /forceload succeeds.
    while(true){
      check();
      try{return await attempt();}catch(error){if(error.code!=='COMMAND_CHUNK_UNLOADED'||Date.now()>=deadline)throw error;}
      await new Promise(resolve=>setTimeout(resolve,options.retryDelay??500));
    }
  }finally{
    if(added){
      // Resource cleanup is necessary even when !stop cancels the trip.
      try{const cleanup=`/forceload remove ${x} ${z}`;await permissions.withCleanupAuthorization(state,cleanup,()=>runCommand(bot,state,cleanup,{timeout:3000}));}
      catch(error){state._lastCommandCleanupError=error.message;console.log('[CommandAssist] Temporary chunk cleanup:',error.message);}
    }
  }
}
async function teleportToSurface(bot,state,target,check=()=>{},options={}) {
  if(state._surfaceTeleportTask||!['idle','thinking'].includes(state.mode))throw new Error('已有任务，请先用 !stop。');
  const previous=state.mode,epoch=state._commandEpoch||0,token={};
  state._surfaceTeleportTask=token;state.mode='thinking';state.currentTask='加载目的地区块并传送';
  const active=()=>{check();if((state._commandEpoch||0)!==epoch||state._surfaceTeleportTask!==token)throw Object.assign(new Error('远程传送已停止'),{code:'TASK_CANCELLED'});};
  try{return await surfaceTeleportCommands(bot,state,target,active,options);}
  finally{if(state._surfaceTeleportTask===token){state._surfaceTeleportTask=null;if((state._commandEpoch||0)===epoch){state.mode=previous;state.currentTask=null;}}}
}
async function executeWithFallback(action,bot,state,config,run,assertActive=()=>{},options={}) {
  if(!action)return run();
  if(action.tool==='cmd'&&!enabled(config,options.message,state,bot))throw new Error('当前要求未授权使用指令。');
  const startedAt=Date.now(),initialEpoch=state._commandEpoch||0,args=action.args||{},item=itemFor(action,bot,options.message),before=item?itemCount(bot,item):0;
  const routeOrigin=(state._lastExpeditionRoute||state._lastNavigationTrail)?.points?.[0];
  const previousLocated=state._lastLocatedTarget,previousExploration=state._lastExplorationResult;
  try{return await run();}catch(error){
    assertActive();
    if((state._commandEpoch||0)!==initialEpoch)throw Object.assign(new Error('任务已停止，不执行指令兜底'),{code:'TASK_CANCELLED'});
    if(error.code==='TASK_CANCELLED'||error.code==='COMMAND_NOT_AUTHORIZED'||!enabled(config,options.message,state,bot)||/已有任务|其他任务|正在执行|参数|无效|必须|数量.*整数/.test(error.message))throw error;
    const tool=action.tool;let result;
    const supported=['come','goto','back','mine','collect','chop_tree','craft','place','drop','find_village','find_biome','locate','explore'];
    if(!supported.includes(tool)||tool==='mine'&&args.strategy==='branch')throw error;
    // Cancellation remains authoritative even after a normal task cleans up.
    const epoch=state._commandEpoch||0;
    const check=()=>{assertActive();if((state._commandEpoch||0)!==epoch)throw Object.assign(new Error('任务已停止'),{code:'TASK_CANCELLED'});};
    bot.chat(`普通动作未完成（${error.message.slice(0,45)}），改用指令达成目标。`);
    try{
      if(tool==='come')result=await teleport(bot,state,config,args.player||config.owner,check);
      else if(tool==='goto')result=await teleport(bot,state,config,{x:args.x,y:args.y??bot.entity.position.y,z:args.z},check);
      else if(tool==='back')result=await teleport(bot,state,config,routeOrigin,check);
      else if(['mine','collect','chop_tree','craft','place'].includes(tool)){
        const count=args.count??(tool==='mine'||tool==='collect'?16:1);
        if(!item||!Number.isSafeInteger(count)||count<=0)throw error;
        const missing=tool==='place'?Math.max(0,1-itemCount(bot,item)):Math.max(0,count-Math.max(0,itemCount(bot,item)-before));
        await giveMissing(bot,state,item,missing,check);
        result={message:`已改用指令补齐 ${missing} 个 ${item}。`,item,count:missing};
        if(tool==='place'||tool==='craft'&&args.place){
          try{result=await require('./crafting-task').runCraftingTask('place',{item},bot,state,check);}
          catch(placeError){
            check();if(placeError.code==='TASK_CANCELLED')throw placeError;
            const {canStand,standingPoint}=require('./terrain'),origin=standingPoint(bot);
            let position;
            for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2]]){const candidate=origin.offset(dx,0,dz);if(canStand(bot,candidate)){position=candidate;break;}}
            if(!position||!bot.registry.blocksByName?.[item])throw placeError;
            result=await runCommand(bot,state,`/setblock ${position.x} ${position.y} ${position.z} minecraft:${item} keep`,{assertActive:check,verify:()=>bot.blockAt(position)?.name===item});
          }
        }
      }else if(tool==='drop'){
        const count=args.count??before;
        if(!item||!Number.isSafeInteger(count)||count<=0)throw error;
        const remaining=Math.max(0,count-Math.max(0,before-itemCount(bot,item)));
        if(!remaining)throw new Error('背包已减少全部交付数量，但玩家接收结果未确认，不重复生成物品。');
        await giveMissing(bot,state,item,Math.max(0,remaining-itemCount(bot,item)),check);
        await teleport(bot,state,config,args.player||config.owner,check);
        result=await require('./item-transfer').dropItem(bot,state,config,{...args,count:remaining},check);
      }else{
        const target=tool==='explore'?state._lastExplorationResult?.target:state._lastLocatedTarget;
        if(!target||(tool==='explore'?state._lastExplorationResult===previousExploration:target===previousLocated||!Number.isFinite(target.foundAt)||target.foundAt<startedAt))throw error;
        result=await teleportToSurface(bot,state,target,check);
        if(tool!=='explore'&&args.guide!==false)await runCommand(bot,state,`/tp ${playerName(config.owner)} @s`,{assertActive:check});
      }
      check();
      const completed={...result,commandFallback:true,originalError:error.message,message:`已改用指令完成：${result?.message||tool}`};
      state._lastCommandFallback={tool,originalError:error.message,message:completed.message,time:Date.now()};return completed;
    }catch(fallbackError){if(fallbackError.code==='TASK_CANCELLED')throw fallbackError;throw new Error(`普通动作失败：${error.message}；指令兜底失败：${fallbackError.message}`);}
  }
}
module.exports={enabled,runCommand,commandReply,executeWithFallback,itemFor,teleportToSurface};
