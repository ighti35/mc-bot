const test=require('node:test'),assert=require('node:assert/strict'),{Vec3}=require('vec3');
const {fillTunnelSupport}=require('../modules/mining-support');
function fixture(){
  const to=new Vec3(1,64,0),floor=to.offset(0,-1,0),blocks=new Map(),calls=[];
  const key=p=>p.toString(),put=(p,name,box)=>blocks.set(key(p),{name,boundingBox:box,position:p});
  put(new Vec3(0,63,0),'stone','block');
  const bot={blockAt:p=>blocks.get(key(p))||{name:'air',boundingBox:'empty',position:p},inventory:{items:()=>[{name:'cobblestone',count:10}]},equip:async()=>calls.push('equip'),placeBlock:async(ref,face)=>{calls.push('place');assert(ref.position.plus(face).equals(floor));put(floor,'cobblestone','block');}};
  return {bot,to,floor,put,calls};
}
test('fills an air gap from an adjacent support and verifies the new ground',async()=>{const f=fixture();assert.equal(await fillTunnelSupport(f.bot,f.to),true);assert.deepEqual(f.calls,['equip','place']);});
test('does not build into liquids, near hazards or without a supporting face',async()=>{
  for(const kind of ['water','lava','missing-face']){const f=fixture();if(kind==='missing-face')f.put(new Vec3(0,63,0),'air','empty');else f.put(f.floor,kind,'empty');assert.equal(await fillTunnelSupport(f.bot,f.to),false);assert.deepEqual(f.calls,[]);}
  const f=fixture();f.put(f.floor.offset(0,-1,0),'lava','empty');assert.equal(await fillTunnelSupport(f.bot,f.to),false);
});
test('unconfirmed placement and missing building materials cannot count as a safe floor',async()=>{
  const f=fixture();f.bot.placeBlock=async()=>{};assert.equal(await fillTunnelSupport(f.bot,f.to),false);
  const g=fixture();g.bot.inventory.items=()=>[{name:'gravel',count:64}];assert.equal(await fillTunnelSupport(g.bot,g.to),false);
});
test('a wall torch at the landing is recovered before solid support is placed',async()=>{
  const f=fixture();f.put(f.floor,'wall_torch','empty');f.bot.dig=async block=>{assert(block.position.equals(f.floor));f.calls.push('recover torch');f.put(f.floor,'air','empty');};
  assert.equal(await fillTunnelSupport(f.bot,f.to),true);assert.deepEqual(f.calls,['recover torch','equip','place']);
});
