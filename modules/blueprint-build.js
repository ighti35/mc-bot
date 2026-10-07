const {runCommand}=require('./command-assist');
const permissions=require('./command-permissions');
const checkpoint=require('./build-checkpoint');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function planChunks(schematic,origin){
  const chunks=new Map();
  if(schematic.packed){
    for(const [bx,by,bz,count,p]of schematic.packed.runs){const y=origin.y+by,z=origin.z+bz,cz=Math.floor(z/16);for(let x=origin.x+bx,end=x+count;x<end;){const cx=Math.floor(x/16),x2=Math.min(end-1,cx*16+15),key=`${cx},${cz}`;if(!chunks.has(key))chunks.set(key,{cx,cz,blocks:[],runs:[]});chunks.get(key).runs.push({x,x2,y,z,block:schematic.packed.palette[p]});x=x2+1;}}
    for(const chunk of chunks.values())chunk.runs.sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x);
  }else for(const b of schematic.blocks){
    const x=origin.x+b.x,y=origin.y+b.y,z=origin.z+b.z,cx=Math.floor(x/16),cz=Math.floor(z/16),key=`${cx},${cz}`;
    if(!chunks.has(key))chunks.set(key,{cx,cz,blocks:[]});
    chunks.get(key).blocks.push({x,y,z,block:b.setblock||b.name});
  }
  // Empty interior chunks are included only in the explicitly approved terrain cleanup.
  for(let cx=Math.floor(origin.x/16);cx<=Math.floor((origin.x+schematic.size.x-1)/16);cx++)for(let cz=Math.floor(origin.z/16);cz<=Math.floor((origin.z+schematic.size.z-1)/16);cz++){
    const key=`${cx},${cz}`;if(!chunks.has(key))chunks.set(key,{cx,cz,blocks:[]});
  }
  return [...chunks.values()].sort((a,b)=>a.cz-b.cz||a.cx-b.cx);
}
function blockRuns(blocks){
  const sorted=[...blocks].sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x),runs=[];
  for(const b of sorted){const last=runs.at(-1);if(last&&last.y===b.y&&last.z===b.z&&last.x2+1===b.x&&last.block===b.block)last.x2=b.x;else runs.push({x:b.x,x2:b.x,y:b.y,z:b.z,block:b.block});}
  return runs;
}
async function executeBlueprint(schematic,origin,bot,state,token){
  const chunks=planChunks(schematic,origin),job=state._buildCheckpoint;let done=job?.done||0,runIndex=0,completedChunks=0,lastReport=Date.now();
  const epoch=state._commandEpoch||0;
  const assertActive=()=>{if(state._buildTask!==token||(state._commandEpoch||0)!==epoch||state.mode!=='building')throw Object.assign(new Error('建造已停止'),{code:'TASK_CANCELLED'});};
  const command=async(text,retry=false)=>{
    const deadline=Date.now()+20000;
    while(true){
      assertActive();
      try{return await runCommand(bot,state,text,{assertActive,allowedModes:['building']});}
      catch(error){if(!retry||error.code!=='COMMAND_CHUNK_UNLOADED'||Date.now()>=deadline)throw error;await sleep(500);}
    }
  };
  for(const chunk of chunks){
    assertActive();const x=chunk.cx*16,z=chunk.cz*16;let added=false;
    const runs=chunk.runs||blockRuns(chunk.blocks),chunkKey=`${chunk.cx},${chunk.cz}`;
    if(runIndex+runs.length<=(job?.nextRun||0)&&(!job?.clearTerrain||job.clearedChunks?.includes(chunkKey))){runIndex+=runs.length;completedChunks++;continue;}
    try{
      const query=await command(`/forceload query ${x} ${z}`);
      if(query.response?.forced!==true){const result=await command(`/forceload add ${x} ${z}`);added=result.response?.added===true;}
      if(job?.clearTerrain&&!job.clearedChunks?.includes(chunkKey)){
        state.currentTask=`清理已授权建筑范围：${chunkKey}`;
        const x1=Math.max(x,origin.x),x2=Math.min(x+15,origin.x+schematic.size.x-1),z1=Math.max(z,origin.z),z2=Math.min(z+15,origin.z+schematic.size.z-1);
        // Slice within the exact blueprint bounds, below Minecraft's fill volume limit.
        for(let y=origin.y;y<origin.y+schematic.size.y;y+=64){
          try{await command(`/fill ${x1} ${y} ${z1} ${x2} ${Math.min(y+63,origin.y+schematic.size.y-1)} ${z2} air`,true);}
          catch(error){if(error.code!=='COMMAND_NO_CHANGE')throw error;}
        }
        (job.clearedChunks||=[]).push(chunkKey);checkpoint.save(state);
      }
      for(const run of runs){
        if(runIndex<(job?.nextRun||0)){runIndex++;continue;}
        // Portal windows must wait until every frame and neighboring structure is in place.
        if(/^minecraft:nether_portal(?:\[|$)/.test(run.block)){runIndex++;if(job){job.nextRun=runIndex;checkpoint.save(state);}continue;}
        const count=run.x2-run.x+1;
        // Replacing is scoped to this exact job's explicit human terrain-cleanup grant.
        // It also handles water flows and auto-created door halves within the blueprint.
        const placement=job?.clearTerrain?'strict':'replace minecraft:air strict';
        const text=count===1&&job?.clearTerrain?`/setblock ${run.x} ${run.y} ${run.z} ${run.block} strict`:`/fill ${run.x} ${run.y} ${run.z} ${run.x2} ${run.y} ${run.z} ${run.block} ${placement}`;
        let result;
        try{result=await command(text,true);}catch(error){if(error.code!=='COMMAND_NO_CHANGE')throw error;}
        // keep can report zero or a partial count when some intended blocks already exist.
        // Query the server before distinguishing successful retry from actual obstruction.
        if(!result||count>1&&result.response?.changed!==count){
          for(let bx=run.x;bx<=run.x2;bx++){
            const check=await command(`/execute if block ${bx} ${run.y} ${run.z} ${run.block}`,true);
            if(check.response?.matched!==true){
              state._buildCollision={x:bx,y:run.y,z:run.z,expected:run.block,origin,design:schematic.name};
              throw new Error(`建筑位置 (${bx},${run.y},${run.z}) 被其他方块占用；已保留原地形，可换空地建造。已完成部分会保留。`);
            }
          }
        }
        done+=count;
        runIndex++;if(job){job.done=done;job.nextRun=runIndex;if(runIndex%100===0)checkpoint.save(state);}
        state._buildProgress={design:schematic.name,done,total:schematic.blocks.length,completedChunks,chunks:chunks.length,origin};
        state.currentTask=`建造 ${schematic.name}：${done}/${schematic.blocks.length}`;
        if(Date.now()-lastReport>30000){lastReport=Date.now();bot.chat(`建造进度 ${done}/${schematic.blocks.length}（${Math.floor(done/schematic.blocks.length*100)}%）`);}
      }
      completedChunks++;
      checkpoint.save(state);
    }catch(error){checkpoint.save(state);if(error.commandResponse?.added===true)added=true;throw error;}
    finally{
      if(added){const text=`/forceload remove ${x} ${z}`;await permissions.withCleanupAuthorization(state,text,()=>runCommand(bot,state,text,{allowedModes:['idle','thinking','building','updating']}));}
    }
  }
  const finishing=await require('./blueprint-finish').finishBlueprint(schematic,origin,bot,state,{assertActive});
  const deferred=require('./packed-schematic').selectBlocks(schematic,b=>b.name==='minecraft:nether_portal').length;
  done+=deferred;if(job)job.done=done;
  if(state._buildProgress)state._buildProgress={...state._buildProgress,done,total:schematic.blocks.length,finishing};
  if(job){job.finishing=finishing;job.completed=true;checkpoint.save(state);}
  return {message:`建造完成：${schematic.name}，服务器已确认 ${done}/${schematic.blocks.length} 个图纸方块。`,done,total:schematic.blocks.length,origin};
}
module.exports={executeBlueprint,planChunks,blockRuns};
