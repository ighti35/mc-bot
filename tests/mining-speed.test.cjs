const test=require('node:test'),assert=require('node:assert/strict');
const {installMiningSpeed}=require('../modules/mining-speed');
test('1.21.11 diamond ores use pickaxe speed while harvest restrictions remain intact',()=>{
  const registry=require('prismarine-registry')('1.21.11'),Block=require('prismarine-block')(registry),type=registry.itemsByName.netherite_pickaxe.id;
  const blocks=['diamond_ore','deepslate_diamond_ore'].map(name=>Block.fromStateId(registry.blocksByName[name].defaultState,0));
  const old=blocks.map(block=>block.digTime(type,false,false,false,[],{}));
  const harvest=blocks.map(block=>block.canHarvest(registry.itemsByName.wooden_pickaxe.id));
  installMiningSpeed({version:'1.21.11',registry});
  blocks.forEach((block,index)=>{const duration=block.digTime(type,false,false,false,[],{});assert(duration<=750);assert(duration<old[index]);assert.equal(block.canHarvest(registry.itemsByName.wooden_pickaxe.id),harvest[index]);});
});
