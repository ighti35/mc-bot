// Normalize protocol component data at the read boundary; keep serialized items intact.
const patched=Symbol('normalized enchantments');
function normalizeEnchantments(data,registry){
  const entries=Array.isArray(data)?data:Array.isArray(data?.enchantments)?data.enchantments:[];
  return entries.map(entry=>{
    const raw=entry.name??entry.id;
    const name=typeof raw==='string'?raw.replace(/^minecraft:/,''):registry.enchantments?.[raw]?.name;
    return {name,lvl:Number(entry.lvl??entry.level??0)};
  }).filter(entry=>typeof entry.name==='string'&&Number.isFinite(entry.lvl)&&entry.lvl>0);
}
function patchItem(item,registry){
  if(!item)return;
  let proto=Object.getPrototypeOf(item);
  while(proto&&!Object.getOwnPropertyDescriptor(proto,'enchants'))proto=Object.getPrototypeOf(proto);
  if(!proto||Object.hasOwn(proto,patched))return;
  const descriptor=Object.getOwnPropertyDescriptor(proto,'enchants');
  if(!descriptor.get||!descriptor.configurable)return;
  Object.defineProperty(proto,'enchants',{...descriptor,get(){
    const component=this.componentMap?.get(this.name==='enchanted_book'?'stored_enchantments':'enchantments');
    return normalizeEnchantments(component?component.data:descriptor.get.call(this),registry);
  }});
  Object.defineProperty(proto,patched,{value:true});
}
function installItemEnchantments(bot){
  const patch=item=>patchItem(item,bot.registry);
  const watch=window=>{
    if(!window)return;
    for(const item of window.slots||[])patch(item);
    if(window._enchantmentsWatched)return;
    window._enchantmentsWatched=true;
    window.on('updateSlot',(_slot,_old,item)=>patch(item));
  };
  watch(bot.inventory);patch(bot.heldItem);
  bot.on('windowOpen',watch);
}
module.exports={normalizeEnchantments,patchItem,installItemEnchantments};
