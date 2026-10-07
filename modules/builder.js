// mc-bot/modules/builder.js — 建造模块（创造模式 + 服务器 /setblock /fill 指令）
// 原生图纸加载，分区块确认放置；保留游戏模式和已有建筑。

// ===== 蓝图：每条是一个 /fill 矩形（相对原点 origin，y 从 0 起）=====
// fields: {x1,y1,z1,x2,y2,z2, block}
// 也用 block:'air' 来抠门/窗（/fill ... air 会把区域内清成空气）

const DESIGNS = {
  // 实心立方体壳
  box: (s) => {
    const w = s, d = s, h = s;
    const L = [];
    L.push(fill(0, 0, 0, w - 1, 0, d - 1, 'floor'));
    L.push(fill(0, h - 1, 0, w - 1, h - 1, d - 1, 'ceil'));
    for (let x = 0; x < w; x++) {
      L.push(fill(x, 1, 0, x, h - 2, 0, 'wall'));
      L.push(fill(x, 1, d - 1, x, h - 2, d - 1, 'wall'));
    }
    for (let z = 0; z < d; z++) {
      L.push(fill(0, 1, z, 0, h - 2, z, 'wall'));
      L.push(fill(w - 1, 1, z, w - 1, h - 2, z, 'wall'));
    }
    return L;
  },

  // 四角柱 + 环箍的塔
  tower: (h) => {
    const L = [];
    const corners = [[0, 0], [0, 2], [2, 0], [2, 2]];
    for (const [x, z] of corners) L.push(fill(x, 0, z, x, h - 1, z, 'wall'));
    for (let y = 0; y < h; y += 4) {
      L.push(fill(0, y, 0, 2, y, 2, 'wall'));
    }
    L.push(fill(0, 0, 0, 2, 0, 2, 'floor'));
    return L;
  },

  // 一堵墙
  wall: (len) => {
    const L = [];
    for (let y = 0; y < Math.max(3, Math.floor(len * 0.7)); y++)
      L.push(fill(0, y, 0, len - 1, y, 0, 'wall'));
    return L;
  },

  // 一块地板
  platform: (s) => {
    return [fill(0, 0, 0, s - 1, 0, s - 1, 'floor')];
  },

  // 小屋：地板 + 四面墙 + 门洞 + 平顶
  house: (s) => {
    const w = s, d = Math.max(3, s), h = Math.max(3, Math.floor(s * 0.8));
    const L = [];
    L.push(fill(0, 0, 0, w - 1, 0, d - 1, 'floor'));
    L.push(fill(0, h, 0, w - 1, h, d - 1, 'ceil'));
    // 前后墙
    L.push(fill(0, 1, 0, w - 1, h - 1, 0, 'wall'));
    L.push(fill(0, 1, d - 1, w - 1, h - 1, d - 1, 'wall'));
    // 左右墙
    L.push(fill(0, 1, 0, 0, h - 1, d - 1, 'wall'));
    L.push(fill(w - 1, 1, 0, w - 1, h - 1, d - 1, 'wall'));
    // 门洞（前面中央，2 格高，左右门框留 1 格）
    const doorX = Math.floor(w / 2);
    L.push(fill(doorX, 1, 0, doorX, 2, 0, 'air'));
    return L;
  },

  // 现代平顶房：更高、大窗、伸出的屋檐
  modern: (s) => {
    const w = Math.max(5, s), d = Math.max(5, s), h = Math.max(4, Math.floor(s * 0.9));
    const L = [];
    L.push(fill(0, 0, 0, w - 1, 0, d - 1, 'floor'));
    L.push(fill(-1, 0, -1, w, 0, d, 'floor')); // 外沿台阶
    L.push(fill(0, h, 0, w - 1, h, d - 1, 'ceil'));
    L.push(fill(-1, h + 1, -1, w, h + 1, d, 'ceil')); // 悬挑屋顶
    L.push(fill(0, 1, 0, w - 1, h - 1, 0, 'wall'));
    L.push(fill(0, 1, d - 1, w - 1, h - 1, d - 1, 'wall'));
    L.push(fill(0, 1, 0, 0, h - 1, d - 1, 'wall'));
    L.push(fill(w - 1, 1, 0, w - 1, h - 1, d - 1, 'wall'));
    // 大面积玻璃窗（前墙中段）
    const glassL = Math.max(1, Math.floor(w / 3));
    const wx = Math.floor(w / 2) - Math.floor(glassL / 2);
    for (let x = wx; x < wx + glassL; x++) L.push(fill(x, 2, 0, x, h - 2, 0, 'window'));
    // 门
    const doorX = Math.floor(w / 2);
    L.push(fill(doorX, 1, 0, doorX, 2, 0, 'air'));
    return L;
  },

  // 木屋：尖顶（阶梯上收）+ 门廊
  cottage: (s) => {
    const w = Math.max(5, s), d = Math.max(5, s), wallH = Math.max(3, Math.floor(s * 0.6));
    const L = [];
    L.push(fill(0, 0, 0, w - 1, 0, d - 1, 'floor'));
    // 墙体
    L.push(fill(0, 1, 0, w - 1, wallH, 0, 'wall'));
    L.push(fill(0, 1, d - 1, w - 1, wallH, d - 1, 'wall'));
    L.push(fill(0, 1, 0, 0, wallH, d - 1, 'wall'));
    L.push(fill(w - 1, 1, 0, w - 1, wallH, d - 1, 'wall'));
    // 山形墙（前后墙每层向内收一格）
    for (let y = 1; y <= Math.floor(d / 2); y++) {
      L.push(fill(y, wallH + y, 0, w - 1 - y, wallH + y, 0, 'wall'));
      L.push(fill(y, wallH + y, d - 1, w - 1 - y, wallH + y, d - 1, 'wall'));
    }
    // 屋顶（左右两面斜坡，用阶梯近似）
    const peakY = wallH + Math.floor(d / 2);
    for (let y = wallH + 1; y <= peakY; y++) {
      const inset = peakY - y;
      L.push(fill(0, y, inset, w - 1, y, inset, 'roof'));
      L.push(fill(0, y, d - 1 - inset, w - 1, y, d - 1 - inset, 'roof'));
    }
    L.push(fill(1, peakY, Math.floor(d / 2), w - 2, peakY, Math.floor(d / 2), 'roof'));
    // 门
    const doorX = Math.floor(w / 2);
    L.push(fill(doorX, 1, 0, doorX, 2, 0, 'air'));
    // 门廊台阶
    L.push(fill(Math.floor(w / 2) - 1, 0, 0, Math.floor(w / 2) + 1, 0, -1, 'floor'));
    return L;
  },

  // 石堡：高墙 + 城齿 + 四角塔
  castle: (s) => {
    const w = Math.max(7, s), d = Math.max(7, s), h = Math.max(5, Math.floor(s * 0.8));
    const L = [];
    L.push(fill(0, 0, 0, w - 1, 0, d - 1, 'floor'));
    // 围墙 1 格厚
    L.push(fill(0, 1, 0, w - 1, h - 1, 0, 'wall'));
    L.push(fill(0, 1, d - 1, w - 1, h - 1, d - 1, 'wall'));
    L.push(fill(0, 1, 0, 0, h - 1, d - 1, 'wall'));
    L.push(fill(w - 1, 1, 0, w - 1, h - 1, d - 1, 'wall'));
    // 城齿（墙顶交替留空）
    for (let x = 0; x < w; x += 2) {
      L.push(fill(x, h, 0, x, h, 0, 'wall'));
      L.push(fill(x, h, d - 1, x, h, d - 1, 'wall'));
    }
    for (let z = 0; z < d; z += 2) {
      L.push(fill(0, h, z, 0, h, z, 'wall'));
      L.push(fill(w - 1, h, z, w - 1, h, z, 'wall'));
    }
    // 四角塔（高出墙 2 格）
    const towerTop = h + 2;
    const corners = [[0, 0], [0, d - 1], [w - 1, 0], [w - 1, d - 1]];
    for (const [cx, cz] of corners) {
      L.push(fill(cx, 1, cz, cx, towerTop, cz, 'wall'));
      L.push(fill(cx - 1, towerTop, cz - 1, cx + 1, towerTop, cz + 1, 'wall'));
    }
    // 城门（前墙中央）
    const doorX = Math.floor(w / 2);
    L.push(fill(doorX, 1, 0, doorX, 2, 0, 'air'));
    return L;
  },

  // 金字塔：每层向内收圆的阶梯
  ziggurat: (s) => {
    const base = Math.max(5, s);
    const L = [];
    const half = Math.floor(base / 2);
    for (let layer = 0; layer < half; layer++) {
      const inset = half - layer;
      L.push(fill(inset, layer, inset, base - 1 - inset, layer, base - 1 - inset, 'wall'));
    }
    return L;
  },
};

// /fill 矩形辅助
function fill(x1, y1, z1, x2, y2, z2, kind) {
  return { x1, y1, z1, x2, y2, z2, kind };
}

// 材质选择：按 kind 映射到 Minecraft 方块名
const MAT = {
  floor: 'stone_bricks', ceil: 'stone_bricks', wall: 'stone_bricks',
  roof: 'oak_planks', window: 'glass',
};
// 根据设计/材质覆盖（design 默认材质）
const DESIGN_MAT = {
  house: 'oak_planks', modern: 'white_concrete', cottage: 'spruce_planks',
  castle: 'stone_bricks', ziggurat: 'sandstone', box: 'stone_bricks',
  tower: 'stone_bricks', wall: 'stone_bricks', platform: 'stone',
};
function blockFor(kind, design, material) {
  if (kind === 'air') return 'air';
  if (kind === 'window') return 'glass';
  if (material) {
    // 用户指定材质：floor/ceil/wall/roof 都用它
    return material;
  }
  return MAT[kind] || DESIGN_MAT[design] || 'stone_bricks';
}

const {loadSchematic,validateSchematic}=require('./schematic-loader');
const {executeBlueprint}=require('./blueprint-build');
const checkpoint=require('./build-checkpoint');
async function startBuilder(args,bot,state,options={}){
  const resolved=require('./schematic-catalog').resolveSchematicName(args[0]);
  if(args.includes('--repair'))return repairLastBlueprint(resolved,bot,state);
  require('./command-permissions').requireAllowed(bot,state);
  if(state._buildTask)throw new Error('已有建造任务，请先用 !stop');
  const [,sizeStr,material]=args,design=resolved;
  const token={},epoch=state._commandEpoch||0;
  state._buildTask=token;state.mode='building';state.currentTask=`读取图纸：${design}`;
  require('./build-protection').installMovementProtection(bot,state);
  try{
    let schematic=await loadSchematic(design);
    if(!schematic){
      const designFn=DESIGNS[design];if(!designFn)throw new Error(`没有找到图纸或房型：${design}`);
      const size=Number(sizeStr||5);if(!Number.isInteger(size)||size<3||size>64)throw new Error('建筑尺寸应为 3 到 64 的整数');
      const positions=new Map();
      for(const r of designFn(size))for(let y=Math.min(r.y1,r.y2);y<=Math.max(r.y1,r.y2);y++)for(let z=Math.min(r.z1,r.z2);z<=Math.max(r.z1,r.z2);z++)for(let x=Math.min(r.x1,r.x2);x<=Math.max(r.x1,r.x2);x++){
        const block=blockFor(r.kind,design,material),key=`${x},${y},${z}`;
        if(block==='air')positions.delete(key);else positions.set(key,{x,y,z,name:block,setblock:block});
      }
      const blocks=[...positions.values()],min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity};
      for(const b of blocks)for(const axis of ['x','y','z']){min[axis]=Math.min(min[axis],b[axis]);max[axis]=Math.max(max[axis],b[axis]);}
      for(const b of blocks)for(const axis of ['x','y','z'])b[axis]-=min[axis];
      schematic={name:design,blocks,totalBlocks:blocks.length,size:{x:max.x-min.x+1,y:max.y-min.y+1,z:max.z-min.z+1}};
    }
    validateSchematic(schematic,bot.registry);
    if(state._buildTask!==token||(state._commandEpoch||0)!==epoch)throw Object.assign(new Error('建造已停止'),{code:'TASK_CANCELLED'});
    const previous=args.includes('--new')?null:checkpoint.restore(bot,schematic,state);
    const pos=options.position||bot.entity.position.floored(),origin=previous?.origin||{x:Math.floor(pos.x)-Math.floor(schematic.size.x/2),y:Math.floor(pos.y),z:Math.floor(pos.z)-Math.floor(schematic.size.z/2)};
    const minY=bot.game?.minY??-64,maxY=minY+(bot.game?.height??384)-1;
    if(origin.y<minY||origin.y+schematic.size.y-1>maxY)throw new Error(`建筑超出世界高度；请站在 Y≤${maxY-schematic.size.y+1} 的位置重试`);
    bot.pathfinder?.setGoal(null);bot.clearControlStates?.();state._wanderEnabled=false;
    state._buildCheckpoint=previous||checkpoint.create(bot,schematic,origin);
    if(options.clearTerrain===true){state._buildCheckpoint.clearTerrain=true;state._buildCheckpoint.cleanupAuthorizedBy=options.owner;}
    checkpoint.save(state);
    state._buildProgress={design,done:state._buildCheckpoint.done,total:schematic.blocks.length,origin};
    bot.chat(`${previous?'继续':'开始'}建造 ${design}：${schematic.blocks.length} 个方块，尺寸 ${schematic.size.x}×${schematic.size.y}×${schematic.size.z}；${state._buildCheckpoint.clearTerrain?'仅清理已授权的建筑范围':'保留已有方块'}，!stop 可停止。`);
    const result=await executeBlueprint(schematic,origin,bot,state,token);
    state._lastBuildResult={success:true,...result};return result;
  }catch(error){state._lastBuildResult={success:false,design,message:error.message};throw error;}
  finally{if(state._buildTask===token){state._buildTask=null;if((state._commandEpoch||0)===epoch){state.mode='idle';state.currentTask=null;}}}
}
async function repairLastBlueprint(design,bot,state,{woodOnly=true}={}){
  require('./command-permissions').requireAllowed(bot,state);
  if(state._buildTask)throw new Error('已有建造任务，请先用 !stop');
  const fs=require('fs'),path=require('path');
  const job=state._buildCheckpoint||JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','build-checkpoint.json'),'utf8'));
  if(job.design!==design||job.username!==bot.username||job.dimension!==bot.game?.dimension||!job.completed)throw new Error('没有找到这份图纸已完成的原址记录');
  const token={},epoch=state._commandEpoch||0;
  state._buildTask=token;state.mode='building';state.currentTask=`检查原址楼梯和紫色落地窗：${design}`;
  require('./build-protection').installMovementProtection(bot,state);
  const assertActive=()=>{if(state._buildTask!==token||(state._commandEpoch||0)!==epoch||state.mode!=='building')throw Object.assign(new Error('建筑修复已停止'),{code:'TASK_CANCELLED'});};
  try{
    const schematic=await loadSchematic(design);validateSchematic(schematic,bot.registry);
    if(checkpoint.create(bot,schematic,job.origin).signature!==job.signature)throw new Error('图纸已变化，不能按旧坐标修复');
    assertActive();require('./task-control').pauseWanderingForCommand(bot,state);bot.pathfinder?.setGoal(null);bot.clearControlStates?.();
    const result=await require('./blueprint-finish').finishBlueprint(schematic,job.origin,bot,state,{assertActive,woodOnly,allowReplace:true});
    state._lastBuildRepair={design,origin:job.origin,...result,success:true};
    job.finishing=result;state._buildCheckpoint=job;checkpoint.save(state);
    return {message:`原址修复完成：检查 ${result.stairsChecked} 个${woodOnly?'木':''}楼梯，校正 ${result.stairsRepaired} 个；${result.portalWindowsVerified} 处下界门的 ${result.portalCellsVerified} 个门体方块已核对。`,...result};
  }finally{if(state._buildTask===token){state._buildTask=null;if((state._commandEpoch||0)===epoch){state.mode='idle';state.currentTask=null;}}}
}
function proceduralBlueprint(design,size=5){
  if(!DESIGNS[design])return null;
  const positions=new Map();
  for(const r of DESIGNS[design](size))for(let y=Math.min(r.y1,r.y2);y<=Math.max(r.y1,r.y2);y++)for(let z=Math.min(r.z1,r.z2);z<=Math.max(r.z1,r.z2);z++)for(let x=Math.min(r.x1,r.x2);x<=Math.max(r.x1,r.x2);x++){
    const name=blockFor(r.kind,design),key=`${x},${y},${z}`;if(name==='air')positions.delete(key);else positions.set(key,{x,y,z,name,setblock:name});
  }
  const blocks=[...positions.values()],min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity};
  for(const b of blocks)for(const a of ['x','y','z']){min[a]=Math.min(min[a],b[a]);max[a]=Math.max(max[a],b[a]);}
  for(const b of blocks)for(const a of ['x','y','z'])b[a]-=min[a];
  return {name:design,blocks,totalBlocks:blocks.length,size:{x:max.x-min.x+1,y:max.y-min.y+1,z:max.z-min.z+1}};
}
module.exports={startBuilder,repairLastBlueprint,proceduralBlueprint};
