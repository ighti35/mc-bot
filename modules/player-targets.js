function resolvePlayer(bot,name) {
  const lower=String(name||'').toLowerCase();
  const entry=Object.entries(bot.players||{}).find(([key,player])=>key.toLowerCase()===lower||player.username?.toLowerCase()===lower)?.[1];
  const valid=entity=>entity&&entity!==bot.entity&&entity.isValid!==false&&entity.position&&[entity.position.x,entity.position.y,entity.position.z].every(Number.isFinite);
  const live=Object.values(bot.entities||{}).filter(valid);
  const match=live.find(entity=>entity.username?.toLowerCase()===lower)||live.find(entity=>entry?.uuid&&entity.uuid===entry.uuid);
  if(match)return match;
  // An old player-list reference may survive entity replacement/teleportation.
  if(valid(entry?.entity)&&bot.entities?.[entry.entity.id]===entry.entity)return entry.entity;
  return null;
}
function describePlayers(bot,owner) {
  return Object.keys(bot.players||{}).filter(name=>name!==bot.username).map(name=>{
    const player=resolvePlayer(bot,name);
    return player?`${name}${name===owner?'(owner)':''}:(${player.position.x.toFixed(2)},${player.position.y.toFixed(2)},${player.position.z.toFixed(2)}) distance=${player.position.distanceTo(bot.entity.position).toFixed(1)}`:`${name}:online, outside loaded view`;
  }).join('; ')||'none';
}
module.exports={resolvePlayer,describePlayers};
