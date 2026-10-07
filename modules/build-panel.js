const fs=require('fs'),path=require('path');
const {loadSchematic,validateSchematic,directory}=require('./schematic-loader');
const {resolveSchematicName}=require('./schematic-catalog');
const permissions=require('./command-permissions');
const {stopCurrentTask}=require('./task-control');
const names={notredame:'巴黎圣母院','large-survival-house':'大型生存屋',sakura:'樱花木屋',clocktower:'哥特钟楼',mansion:'城主府别墅',kamisato:'神里屋敷',xmas_town:'圣诞小镇',sakura_hut:'樱花小屋',granary:'粮仓',shirazu:'白洲梓建筑',ariyama:'阿山城堡',smallhouse:'小型住宅','21981':'预置建筑 21981','maze-fallout':'废土迷宫','maze-vault':'地下堡垒迷宫','maze-catacombs':'地下墓穴迷宫','maze-classic':'经典石砖迷宫',box:'立方体房',tower:'塔楼',wall:'围墙',platform:'平台',house:'小屋',modern:'现代住宅',cottage:'木屋',castle:'城堡',ziggurat:'阶梯金字塔'};
const basics=['box','tower','wall','platform','house','modern','cottage','castle','ziggurat'];
const megaBuilds=require('./mega-builds');for(const m of megaBuilds)names[m.name]=m.label;
const cache=new Map();
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function color(name){
  if(/air/.test(name))return 0;if(/water|ice/.test(name))return 0xff469ad5;
  if(/leaves|moss|grass/.test(name))return 0xff78a35a;if(/cherry|pink/.test(name))return 0xffd69daf;
  if(/glass/.test(name))return 0xff82bfc7;if(/planks|wood|log|oak|spruce/.test(name))return 0xffb08a5d;
  if(/snow|quartz|white|iron/.test(name))return 0xffdce1de;if(/deepslate|black|obsidian/.test(name))return 0xff525b68;
  if(/red|brick/.test(name)&&!name.includes('stone_brick'))return 0xffad7565;return 0xff9baba5;
}
function preview(s){
  const w=Math.min(40,s.size.x),d=Math.min(40,s.size.z),cells=Array(w*d).fill(null);
  const put=(x,z,y,name)=>{const i=z*w+x;if(!cells[i]||cells[i][1]<=y)cells[i]=[color(name),y];};
  if(s.packed){const colors=s.packed.palette.map(color);for(const[x,y,z,n,p]of s.packed.runs){const from=Math.floor(x*w/s.size.x),to=Math.min(w-1,Math.floor((x+n-1)*w/s.size.x)),row=Math.min(d-1,Math.floor(z*d/s.size.z));for(let col=from;col<=to;col++){const i=row*w+col;if(!cells[i]||cells[i][1]<=y)cells[i]=[colors[p],y];}}}
  else for(const b of s.blocks)put(Math.min(w-1,Math.floor(b.x*w/s.size.x)),Math.min(d-1,Math.floor(b.z*d/s.size.z)),b.y,b.name);
  return {width:w,depth:d,cells:cells.map(c=>c||[0,0])};
}
async function entry(name,size=5){
  name=resolveSchematicName(name);const basic=basics.includes(name);
  if(typeof name!=='string'||!/^[a-z0-9_-]+$/.test(name))throw fail('图纸名称无效');
  const files=fs.readdirSync(directory).filter(f=>f.startsWith(name+'.')&&/\.(json|litematic|schem|schematic)$/.test(f));
  if(!basic&&!files.length)throw fail(megaBuilds.find(m=>m.name===name)?.unavailable||'没有这份建筑图纸',404);
  const previews=require('./build-preview-cache'),stamp=basic?size:previews.fingerprint(directory,files);const key=name+':'+stamp;
  if(cache.has(key))return cache.get(key);
  if(!basic){const stored=previews.read(name,stamp);if(stored){const result={...stored,label:names[name]||stored.label};cache.set(key,result);return result;}}
  const s=basic?require('./builder').proceduralBlueprint(name,size):await loadSchematic(name);
  validateSchematic(s);
  const result={id:name,label:names[name]||'建筑图纸 '+name,category:basic?'基础房型':name.startsWith('maze-')?'迷宫':'建筑图纸',size:s.size,blocks:s.blocks.length,procedural:basic,parameterSize:basic?size:null,preview:preview(s)};
  cache.set(key,result);return result;
}
async function catalog(){
  const ids=[...new Set([...fs.readdirSync(directory).filter(f=>/\.(json|litematic|schem|schematic)$/.test(f)).map(f=>path.basename(f,path.extname(f))),...megaBuilds.map(m=>m.name)])];
  const items=[];for(const id of [...ids,...basics]){try{items.push(await entry(id));}catch(error){items.push({id,label:(names[id]||'建筑图纸 '+id)+'（未就绪）',category:'不可用',error:error.message});}}
  return items;
}
function snapshot({bot,state,config}){
  let saved=state._buildCheckpoint; if(!saved)try{saved=JSON.parse(fs.readFileSync(path.join(directory,'..','build-checkpoint.json'),'utf8'));}catch{}
  const same=saved?.username===bot?.username&&saved?.dimension===bot?.game?.dimension;
  return {connected:bot?._client?.state==='play',owner:config.owner,username:bot?.username||config.username,mode:state.mode,task:state.currentTask,gameMode:bot?.game?.gameMode,commandAllowed:permissions.creative(bot,state)||permissions.active(state)||permissions.pending(state,config.owner),busy:Boolean(state._buildPanelTask||state._buildTask||state._aiRequest||state._inventoryTask||state._gameInventoryTask||state._craftTask||state._miningTask||state._navigationTask||state._explorationTask||state.mode!=='idle'),progress:state._buildProgress||null,lastResult:state._lastBuildResult||null,resume:same&&!saved.completed?{id:saved.design,label:names[saved.design]||saved.design,done:saved.done,origin:saved.origin,clearTerrain:Boolean(saved.clearTerrain)}:null,position:bot?.entity?{x:Math.floor(bot.entity.position.x),y:Math.floor(bot.entity.position.y),z:Math.floor(bot.entity.position.z)}:null};
}
async function action(getContext,body,dependencies={}){
  if(!body||typeof body!=='object'||Array.isArray(body))throw fail('无效请求');
  const {bot,state,config}=getContext();
  if(body.viewer!==config.owner)throw fail('只有主人可以操作建筑菜单',403);
  if(bot?._client?.state!=='play'||!bot.entity)throw fail('机器人不在线',409);
  if(body.action==='stop'){stopCurrentTask(bot,state);return {accepted:true,message:'已停止当前任务，已放置的建筑方块会保留。'};}
  if(body.action!=='build')throw fail('未知的建筑操作');
  if(snapshot({bot,state,config}).busy)throw fail('机器人已有任务，请先停止或等待结束',409);
  const id=resolveSchematicName(body.id),size=Number(body.size||5);
  if(!Number.isInteger(size)||size<3||size>64)throw fail('基础房型尺寸应为 3 到 64');
  const p=body.position;
  if(!body.resume&&(!p||!['x','y','z'].every(a=>Number.isFinite(p[a])&&Number.isInteger(p[a]))||Math.abs(p.x)>29999984||Math.abs(p.z)>29999984))throw fail('建造坐标无效');
  const token={},epoch=state._commandEpoch||0;state._buildPanelTask=token;let release=()=>{};
  try{
    const selected=await (dependencies.entry||entry)(id,size);
    if(state._buildPanelTask!==token||(state._commandEpoch||0)!==epoch||getContext().bot!==bot||bot._client.state!=='play')throw fail('建造请求已取消',409);
    if(body.resume&&snapshot({bot,state,config}).resume?.id!==id)throw fail('没有该建筑的未完成断点');
    if(!body.resume){const minY=bot.game?.minY??-64,maxY=minY+(bot.game?.height??384)-1;if(p.y<minY||p.y+selected.size.y-1>maxY)throw fail('建筑超出世界高度，请降低建造位置');}
    release=permissions.begin(config.owner,body.allowCommands===true?'这次可以用指令':'',bot,state,config);permissions.requireAllowed(bot,state);
    state._lastBuildResult=null;
    const start=dependencies.startBuilder||require('./builder').startBuilder;
    const promise=start([id,String(size),null,...(body.resume?[]:['--new'])],bot,state,{position:p,clearTerrain:!body.resume&&body.clearTerrain===true,owner:config.owner});
    Promise.resolve(promise).then(result=>{state._lastBuildResult={success:true,...result};bot.chat(result.message);}).catch(error=>{state._lastBuildResult={success:false,design:id,message:error.message};if(error.code!=='TASK_CANCELLED')bot.chat(`建造暂停：${error.message}`);}).finally(()=>{release();if(state._buildPanelTask===token)state._buildPanelTask=null;});
    return {accepted:true,message:`已开始${body.resume?'续建':'建造'}：${selected.label}`};
  }catch(error){release();if(state._buildPanelTask===token)state._buildPanelTask=null;throw error;}
}
module.exports={catalog,entry,snapshot,action,preview};
