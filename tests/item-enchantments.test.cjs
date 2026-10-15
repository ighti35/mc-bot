const test=require('node:test'),assert=require('node:assert/strict');
const registry=require('prismarine-registry')('1.21.11');
const {patchItem,installItemEnchantments}=require('../modules/item-enchantments');
const {EventEmitter}=require('node:events');
function item(name='netherite_pickaxe',type='enchantments'){
  const Item=require('prismarine-item')(registry),value=new Item(registry.itemsByName[name].id,1);
  value.componentMap=new Map([[type,{data:{enchantments:[{id:registry.enchantmentsByName.efficiency.id,level:5}]}}]]);return value;
}
test('real 1.21.11 component item becomes iterable and efficiency changes real block dig time',()=>{
  const tool=item();assert(!Array.isArray(tool.enchants));const before=JSON.stringify(tool.componentMap.get('enchantments'));
  patchItem(tool,registry);assert.deepEqual(tool.enchants,[{name:'efficiency',lvl:5}]);
  const Block=require('prismarine-block')(registry),block=Block.fromStateId(registry.blocksByName.deepslate.defaultState,0);
  const plain=block.digTime(tool.type,false,false,false,[],{}),enchanted=block.digTime(tool.type,false,false,false,tool.enchants,{});
  assert(enchanted<plain);assert.equal(JSON.stringify(tool.componentMap.get('enchantments')),before);patchItem(tool,registry);assert.equal(tool.enchants.length,1);
});
test('stored enchantment components on books are read without modifying serialization',()=>{
  const book=item('enchanted_book','stored_enchantments');patchItem(book,registry);assert.deepEqual(book.enchants,[{name:'efficiency',lvl:5}]);
});
test('future inventory and opened window items receive the same compatibility handling',()=>{
  const bot=new EventEmitter(),inventory=new EventEmitter();inventory.slots=[];Object.assign(bot,{registry,inventory});installItemEnchantments(bot);
  const tool=item();inventory.emit('updateSlot',36,null,tool);assert(Array.isArray(tool.enchants));
  const window=new EventEmitter(),book=item('enchanted_book','stored_enchantments');window.slots=[book];bot.emit('windowOpen',window);assert.equal(book.enchants[0].lvl,5);
});
