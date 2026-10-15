const {runCommand}=require('./command-assist');
const permissions=require('./command-permissions');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const key=b=>`${b.x},${b.y},${b.z}`;
const {selectBlocks}=require('./packed-schematic');
function portalGroups(schematic){
  const remaining=new Map(selectBlocks(schematic,b=>b.name==='minecraft:nether_portal').map(b=>[key(b),b])),groups=[];
  if(!remaining.size)return groups;
  const source=new Map(selectBlocks(schematic,b=>b.name==='minecraft:obsidian').map(b=>[key(b),b]));
  while(remaining.size){
    const first=remaining.values().next().value,queue=[first],cells=[];remaining.delete(key(first));
    while(queue.length){const b=queue.pop();cells.push(b);for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
      const k=key({x:b.x+dx,y:b.y+dy,z:b.z+dz});if(remaining.has(k)){queue.push(remaining.get(k));remaining.delete(k);}
    }}
    const min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity};
    for(const b of cells)for(const axis of ['x','y','z']){min[axis]=Math.min(min[axis],b[axis]);max[axis]=Math.max(max[axis],b[axis]);}
    const axis=/axis=z/.test(first.setblock||'')?'z':'x',fixed=axis==='x'?'z':'x';
    const width=max[axis]-min[axis]+1,height=max.y-min.y+1,frame=[];
    for(let a=min[axis];a<=max[axis];a++)for(const y of [min.y-1,max.y+1])frame.push({...min,[axis]:a,y});
    for(let y=min.y;y<=max.y;y++)for(const a of [min[axis]-1,max[axis]+1])frame.push({...min,[axis]:a,y});
    const valid=width>=2&&width<=21&&height>=3&&height<=21&&min[fixed]===max[fixed]&&cells.length===width*height&&frame.every(b=>source.get(key(b))?.name==='minecraft:obsidian');
    groups.push({cells,frame,min,max,axis,valid});
  }
  return groups;
}
function woodenStairs(b){return /^minecraft:(?:oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_stairs$/.test(b.name);}
async function finishBlueprint(schematic,origin,bot,state,{assertActive=()=>{},woodOnly=false,allowReplace=Boolean(state._buildCheckpoint?.clearTerrain)}={}){
  const at=b=>({x:origin.x+b.x,y:origin.y+b.y,z:origin.z+b.z});
  const stats={stairsChecked:0,stairsRepaired:0,portalWindowsVerified:0,portalCellsRestored:0,portalCellsVerified:0};
  const command=async text=>{
    const deadline=Date.now()+20000;
    while(true){assertActive();try{return await runCommand(bot,state,text,{assertActive,allowedModes:['building']});}catch(error){if(error.code!=='COMMAND_CHUNK_UNLOADED'||Date.now()>=deadline)throw error;await sleep(300);}}
  };
  const matches=async(b,block)=>{const p=at(b);return (await command(`/execute if block ${p.x} ${p.y} ${p.z} ${block}`)).response?.matched===true;};
  const place=async(b,block,mode='strict')=>{const p=at(b);try{await command(`/setblock ${p.x} ${p.y} ${p.z} ${block} ${mode}`);}catch(error){if(error.code!=='COMMAND_NO_CHANGE')throw error;}};
  async function withChunks(blocks,run){
    const positions=new Map(blocks.map(b=>{const p=at(b),x=Math.floor(p.x/16)*16,z=Math.floor(p.z/16)*16;return [`${x},${z}`,{x,z}];})),owned=[];
    try{
      for(const p of positions.values()){
        const result=await command(`/forceload query ${p.x} ${p.z}`);
        if(!result.response?.forced){try{const added=await command(`/forceload add ${p.x} ${p.z}`);if(added.response?.added)owned.push(p);}catch(error){if(error.commandResponse?.added)owned.push(p);throw error;}}
      }
      return await run();
    }finally{
      for(const p of owned){const text=`/forceload remove ${p.x} ${p.z}`;try{await permissions.withCleanupAuthorization(state,text,()=>runCommand(bot,state,text,{allowedModes:['building','idle','thinking','updating']}));}catch(error){console.error('[Builder] 收尾区块释放失败:',error.message);}}
    }
  }
  const stairs=selectBlocks(schematic,b=>b.name.endsWith('_stairs')&&(!woodOnly||woodenStairs(b)));
  const chunks=new Map();for(const b of stairs){const p=at(b),k=`${Math.floor(p.x/16)},${Math.floor(p.z/16)}`;if(!chunks.has(k))chunks.set(k,[]);chunks.get(k).push(b);}
  for(const blocks of chunks.values())await withChunks(blocks,async()=>{
    for(const b of blocks){
      assertActive();const block=b.setblock||b.name;stats.stairsChecked++;state.currentTask=`校正楼梯：${stats.stairsChecked}/${stairs.length}`;
      if(!await matches(b,block)){if(!allowReplace&&!await matches(b,b.name)&&!await matches(b,'minecraft:air'))throw new Error(`楼梯位置被其他方块占用：${key(at(b))}`);await place(b,block);stats.stairsRepaired++;}
    }
    // Verify after the whole chunk has been restored, rather than just trusting command feedback.
    for(const b of blocks)if(!await matches(b,b.setblock||b.name))throw new Error(`楼梯状态校正未通过：${key(at(b))}`);
  });
  // These are decorative portal windows. Restore them last, without ignition or shape updates.
  // A decorative window may intentionally lack a valid travel-portal frame.
  for(const group of portalGroups(schematic))await withChunks([...group.cells,...group.frame],async()=>{
    state.currentTask=`修复紫色落地窗 ${stats.portalWindowsVerified+1}`;
    for(const b of group.cells){const block=b.setblock||`minecraft:nether_portal[axis=${group.axis}]`;if(!await matches(b,block)){if(!allowReplace&&!await matches(b,'minecraft:nether_portal')&&!await matches(b,'minecraft:air'))throw new Error(`下界门位置被其他方块占用：${key(at(b))}`);await place(b,block);stats.portalCellsRestored++;}}
    for(const b of group.cells){if(!await matches(b,b.setblock||`minecraft:nether_portal[axis=${group.axis}]`))throw new Error(`紫色窗面修复未确认：${key(at(b))}`);stats.portalCellsVerified++;}
    stats.portalWindowsVerified++;
  });
  return stats;
}
module.exports={portalGroups,woodenStairs,finishBlueprint};
