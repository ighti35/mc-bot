const {FACES,vector,isSupport,HAZARDS}=require('./terrain');
const {waitForAction}=require('./task-control');
const MATERIALS=new Set(['cobblestone','cobbled_deepslate','dirt','stone','deepslate','netherrack','andesite','diorite','granite','tuff']);
async function fillTunnelSupport(bot,to,assertActive=()=>{}){
  assertActive();const position=vector(to).offset(0,-1,0),existing=bot.blockAt(position);
  if(isSupport(existing))return true;
  const torch=existing&&['torch','wall_torch'].includes(existing.name);
  if(!existing||!['air','cave_air','void_air','torch','wall_torch'].includes(existing.name))return false;
  const neighbors=FACES.map(face=>({face,block:bot.blockAt(position.plus(face))}));
  if(neighbors.some(entry=>!entry.block||HAZARDS.has(entry.block.name)))return false;
  const reference=neighbors.find(entry=>isSupport(entry.block));
  const material=bot.inventory.items().find(item=>MATERIALS.has(item.name)&&item.count>0);
  if(!reference||!material)return false;
  if(torch){
    await waitForAction(bot.dig(existing,true),{assertActive,timeout:3000});
    assertActive();
    if(!['air','cave_air','void_air'].includes(bot.blockAt(position)?.name))return false;
  }
  await waitForAction(bot.equip(material,'hand'),{assertActive,timeout:5000});
  await waitForAction(bot.placeBlock(reference.block,reference.face.scaled(-1)),{assertActive,timeout:5000});
  assertActive();return isSupport(bot.blockAt(position));
}
module.exports={fillTunnelSupport};
