const fs=require('fs'),path=require('path'),crypto=require('crypto');
const file=path.join(__dirname,'..','data','build-checkpoint.json');
function signature(s){return crypto.createHash('sha256').update(JSON.stringify(s.packed||{size:s.size,blocks:s.blocks})).digest('hex');}
function restore(bot,schematic,state,filename=file){
  const hash=signature(schematic);let previous=state._buildCheckpoint;
  if(!previous)try{previous=JSON.parse(fs.readFileSync(filename,'utf8'));}catch{}
  if(previous&&!previous.completed&&previous.planVersion===2&&previous.username===bot.username&&previous.dimension===bot.game?.dimension&&previous.design===schematic.name&&previous.signature===hash)return previous;
  if(previous?.completed&&previous.design===schematic.name)return null;
  // Upgrade progress created before checkpoint support without moving the existing build.
  const progress=state._buildProgress;
  if(state._lastBuildResult?.success!==true&&progress?.design===schematic.name&&progress.total===schematic.blocks.length&&progress.origin)return {username:bot.username,dimension:bot.game?.dimension,design:schematic.name,signature:hash,origin:progress.origin,done:0,nextRun:0,completed:false};
  return null;
}
function create(bot,schematic,origin){return {username:bot.username,dimension:bot.game?.dimension,design:schematic.name,signature:signature(schematic),origin,done:0,nextRun:0,completed:false,planVersion:2};}
function save(state,filename=file){
  const job=state._buildCheckpoint;if(!job)return;
  try{fs.writeFileSync(filename+'.tmp',JSON.stringify(job));fs.renameSync(filename+'.tmp',filename);}catch(error){console.error('[Builder] 断点保存失败:',error.message);}
}
module.exports={restore,create,save};
