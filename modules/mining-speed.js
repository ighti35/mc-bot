// 1.21.11 data labels these pickaxe blocks with a harvest restriction tag.
// That restriction must not replace the pickaxe's breaking-speed multiplier.
function installMiningSpeed(bot){
  if(bot.version!=='1.21.11')return;
  const materials=bot.registry.materials,pickaxe=materials?.['mineable/pickaxe'];
  if(!pickaxe)return;
  for(const block of bot.registry.blocksArray||[]){
    if(block.material?.startsWith('incorrect_for_'))materials[block.material]={...pickaxe};
  }
}
module.exports={installMiningSpeed};
