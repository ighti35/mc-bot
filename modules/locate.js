const { waitForAction, pauseWanderingForCommand } = require('./task-control');

const BIOMES = {
  '樱花林':'cherry_grove','樱花群系':'cherry_grove','樱花':'cherry_grove','沙漠':'desert','红树林':'mangrove_swamp','沼泽':'swamp',
  '热带雨林':'jungle','雨林':'jungle','竹林':'bamboo_jungle','蘑菇岛':'mushroom_fields','蘑菇群系':'mushroom_fields',
  '针叶林':'taiga','雪原':'snowy_plains','雪林':'snowy_taiga','恶地':'badlands','平原':'plains','草原':'plains',
  '黑森林':'dark_forest','繁花森林':'flower_forest','森林':'forest','暖海':'warm_ocean','海洋':'ocean','冰刺':'ice_spikes',
  '雪山':'frozen_peaks','雪坡':'snowy_slopes','石峰':'stony_peaks','繁茂洞穴':'lush_caves','溶洞':'dripstone_caves',
  '深暗之域':'deep_dark','苍白花园':'pale_garden','绯红森林':'crimson_forest','诡异森林':'warped_forest','灵魂沙峡谷':'soul_sand_valley',
};
const STRUCTURES = {'村庄':'#minecraft:village',village:'#minecraft:village','要塞':'stronghold','沙漠神殿':'desert_pyramid','丛林神庙':'jungle_pyramid','林地府邸':'mansion','下界要塞':'fortress','远古城市':'ancient_city'};

function resolveTarget(bot, kind, input) {
  if (!['structure','biome'].includes(kind)) throw new Error('定位类型必须为 structure 或 biome。');
  const original=String(input||'').trim();
  let id=(kind==='biome'?BIOMES:STRUCTURES)[original] || (kind==='biome'?BIOMES:STRUCTURES)[original.toLowerCase()] || original.toLowerCase().replace(/\s+/g,'_');
  if (!/^#?(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(id)) throw new Error('目标名称无效，请使用群系或结构名称。');
  if(kind==='biome') {
    if(id.startsWith('#'))throw new Error('群系定位请提供具体群系名称。');
    const name=id.replace(/^minecraft:/,'');
    if(!bot.registry.biomesByName?.[name]&&!bot.registry.biomesByName?.['minecraft:'+name]&&!bot.registry.biomesArray?.some(entry=>entry.name.replace(/^minecraft:/,'')===name))throw new Error(`当前版本没有识别到群系：${original}`);
  }
  if(!id.includes(':'))id='minecraft:'+id;
  const label=kind==='structure'?(Object.keys(STRUCTURES).find(name=>STRUCTURES[name]===id||'minecraft:'+STRUCTURES[name]===id)||original):(Object.keys(BIOMES).find(name=>BIOMES[name]===id.replace(/^minecraft:/,''))||original);
  return {kind,id,label};
}

function parseLocateReply(message, kind) {
  const json=message?.json || message;
  const translated=[];
  const visit=node=>{if(!node||typeof node!=='object')return;if(node.translate)translated.push(node.translate);for(const child of [...(node.with||[]),...(node.extra||[])])visit(child);};
  visit(json);
  const text=typeof message==='string'?message:message?.toString?.()||'';
  if(translated.some(key=>/not_found|permission|unknown.command|invalid|incomplete/.test(key)) || /Unknown or incomplete command|没有权限|未知或不完整|无法找到|Could not find|not permitted/i.test(text)) {
    return {error:`服务器定位失败：${text.slice(0,140)}（请确认机器人有 /locate 权限及目标在当前维度）。`};
  }
  if(!translated.includes(`commands.locate.${kind}.success`) && !/^(?:The nearest|最近的|最近|Located)/i.test(text))return null;
  const match=text.match(/\[\s*(-?\d+)\s*,\s*(~|-?\d+)\s*,\s*(-?\d+)\s*\]/);
  if(!match)return null;
  return {x:Number(match[1]),y:match[2]==='~'?null:Number(match[2]),z:Number(match[3])};
}

async function locateTarget(bot,state,args={},assertActive=()=>{}) {
  require('./command-permissions').requireAllowed(bot,state);
  const target=resolveTarget(bot,args.kind||'structure',args.target||'village');
  if(state._locateTask)throw new Error('已有定位请求，请稍等。');
  const epoch=state._commandEpoch||0,token={},previousMode=['idle','thinking'].includes(state.mode)?state.mode:'idle';
  pauseWanderingForCommand(bot,state);state._locateTask=token;state.mode='locating';state.currentTask=`定位${target.label}`;
  const check=()=>{assertActive();if((state._commandEpoch||0)!==epoch||state._locateTask!==token){const error=new Error('定位已停止');error.code='TASK_CANCELLED';throw error;}};
  let onMessage;
  try {
    const reply=new Promise((resolve,reject)=>{
      onMessage=(message,position)=>{
        if(position!=='system'&&position!==1)return;
        const result=parseLocateReply(message,target.kind);
        if(result?.error)reject(new Error(result.error));else if(result)resolve(result);
      };
      bot.on('message',onMessage);
    });
    check();bot.chat(`/locate ${target.kind} ${target.id}`);
    const coordinates=await waitForAction(reply,{assertActive:check,timeout:args.locateTimeout??20000});
    const result={...target,...coordinates,dimension:bot.game?.dimension,foundAt:Date.now()};
    state._lastLocatedTarget=result;
    bot.chat(`已定位${target.label}：(${result.x},${result.y??'地表'},${result.z})。`);
    return result;
  } finally {
    if(onMessage)bot.removeListener('message',onMessage);
    if(state._locateTask===token){state._locateTask=null;if((state._commandEpoch||0)===epoch&&state.mode==='locating'){state.mode=previousMode;state.currentTask=null;}}
  }
}

async function locateAndGuide(bot,state,config={},args={},assertActive=()=>{}) {
  const target=await locateTarget(bot,state,args,assertActive);
  if(args.guide===false)return {...target,message:`已定位${target.label}：(${target.x},${target.y??'地表'},${target.z})。`};
  return require('./journey').travelJourney(bot,state,config,{...args,...target,lead:args.lead??true,label:target.label,biome:target.kind==='biome'?target.id.replace(/^minecraft:/,''):undefined},assertActive);
}

function detectLocateRequest(message) {
  if(!/(?:找|前往|定位|带我|带路|去|find|locate|lead|take me|go to)/i.test(message)||/(?:不要|别去|别找|怎么|为什么)/.test(message))return null;
  if(/村庄|\bvillage\b/i.test(message))return {kind:'structure',target:'village',guide:true};
  // Match full structure names before overlapping biome words (沙漠神殿/沙漠).
  for(const name of Object.keys(STRUCTURES).sort((a,b)=>b.length-a.length))if(message.includes(name))return {kind:'structure',target:STRUCTURES[name],guide:true};
  for(const name of Object.keys(BIOMES).sort((a,b)=>b.length-a.length))if(message.includes(name))return {kind:'biome',target:BIOMES[name],guide:true};
  const explicit=message.match(/(?:biome|群系)\s*[:：]?\s*([a-z][a-z0-9_:]*)/i);
  return explicit?{kind:'biome',target:explicit[1],guide:true}:null;
}

module.exports={locateTarget,locateAndGuide,parseLocateReply,resolveTarget,detectLocateRequest};
