const fs = require('fs');
const path = require('path');
const { DIRECTIONS, directionAliases, dimensionName } = require('./mining-plan');
const { vector, findSafeGround } = require('./terrain');
const { navigateTo, appendTrail } = require('./navigation');
const { pauseWanderingForCommand } = require('./task-control');

const cellKey = point => `${Math.floor(point.x / 8)},${Math.floor(point.z / 8)}`;
function rememberCell(map, point, status, reason = '') {
  const key = cellKey(point);
  const previous = map.cells[key];
  if (previous?.status === 'visited' && status === 'blocked') return;
  map.cells[key] = { position: { x: point.x, y: point.y, z: point.z }, status, visits: (previous?.visits || 0) + (status === 'visited' ? 1 : 0), reason, time: Date.now() };
  if (Object.keys(map.cells).length > 1024) delete map.cells[Object.keys(map.cells)[0]];
}

function frontierCandidates(bot, map, target) {
  const current = bot.entity.position;
  const heading = Math.atan2(target.z - current.z, target.x - current.x);
  const candidates = [];
  for (const angle of [0, Math.PI / 8, -Math.PI / 8, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
    const x = current.x + Math.cos(heading + angle) * 10;
    const z = current.z + Math.sin(heading + angle) * 10;
    const point = findSafeGround(bot, x, z, current.y, { radius: 2, rise: 5, drop: 3 });
    if (!point) { rememberCell(map, { x, y: current.y, z }, 'blocked', '没有安全落脚点或区块未加载'); continue; }
    if (point.distanceTo(current) < 3) continue;
    const memory = map.cells[cellKey(point)];
    if ((memory?.visits || 0) >= 2) continue;
    if (memory?.status === 'blocked' && Date.now() - memory.time < 60000) continue;
    const remaining = Math.hypot(target.x - point.x, target.z - point.z);
    const score = remaining + (memory?.visits || 0) * 20 + Math.abs(point.y - current.y) * 2;
    candidates.push({ point, score });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates;
}

function observeLandmarks(bot, map) {
  const interesting = name => /(?:^|_)ore$/.test(name || '') || ['crafting_table', 'chest', 'furnace', 'water', 'lava'].includes(name) || /_log$|_bed$/.test(name || '');
  const positions = bot.findBlocks({ matching: block => Boolean(block) && interesting(block.name), maxDistance: 12, count: 16 });
  for (const point of positions) {
    const block = bot.blockAt(point);
    if (!block) continue;
    const key = `${point.x},${point.y},${point.z}`;
    if (!map.landmarks.some(mark => mark.key === key)) map.landmarks.push({ key, name: block.name, position: { x: point.x, y: point.y, z: point.z } });
  }
  map.landmarks = map.landmarks.slice(-128);
  const feet = bot.blockAt(bot.entity.position.floored());
  map.biome = require('./terrain').biomeName(bot,feet);
}

async function exploreTerrain(bot, state, config = {}, args = {}, assertActive = () => {}) {
  const direction=directionAliases[args.direction]||args.direction||'north';
  if(!DIRECTIONS[direction])throw new Error('探路方向必须是 north、south、east 或 west。');
  const distance=args.distance??96;
  if(!Number.isSafeInteger(distance)||distance<8||distance>512)throw new Error('探路距离必须是 8 到 512 格的整数。');
  const origin=bot.entity.position.floored();
  if((args.x===undefined)!==(args.z===undefined))throw new Error('坐标探路需要同时提供 x 和 z。');
  const x=args.x??origin.x+DIRECTIONS[direction].x*distance,z=args.z??origin.z+DIRECTIONS[direction].z*distance;
  if(![x,z].every(Number.isFinite)||Math.hypot(x-origin.x,z-origin.z)>512)throw new Error('本次探路目标必须在 512 格以内。');
  return require('./journey').travelJourney(bot,state,config,{...args,x,z,label:'探路目标',timeout:args.timeout??240000,lead:args.lead??false},assertActive);
}

module.exports = { exploreTerrain, frontierCandidates, rememberCell, observeLandmarks, cellKey };
