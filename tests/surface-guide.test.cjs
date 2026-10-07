const test=require('node:test'),assert=require('node:assert/strict'),{Vec3}=require('vec3');
const {openToSky}=require('../modules/surface-guide');
test('an underground tunnel roof and an unloaded column cannot be called surface',()=>{
  const bot={game:{minY:-64,height:384},blockAt:p=>({name:p.y===70?'stone':'air',boundingBox:p.y===70?'block':'empty'})};
  assert.equal(openToSky(bot,new Vec3(0,-40,0)),false);
  assert.equal(openToSky(bot,new Vec3(0,71,0)),true);
  bot.blockAt=()=>null;assert.equal(openToSky(bot,new Vec3(0,71,0)),false);
});
