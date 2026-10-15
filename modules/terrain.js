const { Vec3 } = require('vec3');
const HAZARDS = new Set(['lava', 'water', 'fire', 'soul_fire', 'magma_block', 'campfire', 'soul_campfire', 'powder_snow', 'cactus', 'sweet_berry_bush', 'pointed_dripstone']);
const NATURAL = new Set(['stone', 'deepslate', 'tuff', 'granite', 'andesite', 'diorite', 'dirt', 'grass_block', 'coarse_dirt', 'rooted_dirt', 'netherrack', 'basalt', 'blackstone', 'calcite']);
const FACES = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const vector = point => new Vec3(point.x, point.y, point.z);
const isPassable = block => Boolean(block) && !HAZARDS.has(block.name) && block.boundingBox === 'empty';
const isSupport = block => Boolean(block) && !HAZARDS.has(block.name) && block.boundingBox === 'block';
const isNatural = block => Boolean(block) && (NATURAL.has(block.name) || /(?:^|_)ore$/.test(block.name) || block.name === 'ancient_debris');

function canStand(bot, point) {
  const feet = vector(point);
  return isPassable(bot.blockAt(feet)) && isPassable(bot.blockAt(feet.offset(0, 1, 0))) && isSupport(bot.blockAt(feet.offset(0, -1, 0)));
}

function standingPoint(bot) {
  const position=bot.entity.position,point=position.floored(),block=bot.blockAt(point);
  // Paths, farmland and slabs place the feet slightly below an integer Y.
  // Pathfinder uses the air cell above their support rather than floor(feetY).
  if(block?.boundingBox==='block'&&block.shapes?.length) {
    const localX=position.x-point.x,localZ=position.z-point.z;
    const shapes=block.shapes.filter(s=>localX+.3>s[0]&&localX-.3<s[3]&&localZ+.3>s[2]&&localZ-.3<s[5]);
    const top=shapes.length?Math.max(...shapes.map(s=>s[4])):0;
    if(top>0&&Math.abs(position.y-(point.y+top))<.08)return point.offset(0,1,0);
  }
  return point;
}

function biomeName(bot, block) {
  const biome=block?.biome;
  const id=typeof biome==='number'?biome:biome?.id;
  const definition=bot.registry.biomes?.[id] || bot.registry.biomesArray?.find(entry=>entry.id===id);
  return String((typeof biome==='object'?biome?.name:'')||definition?.name||'unknown').replace(/^minecraft:/,'');
}

function findSafeGround(bot, x, z, referenceY, options = {}) {
  const radius = options.radius ?? 2;
  const rise = options.rise ?? 5;
  const drop = options.drop ?? 3;
  const candidates = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dy = -drop; dy <= rise; dy++) {
        const point = new Vec3(Math.floor(x) + dx, Math.floor(referenceY) + dy, Math.floor(z) + dz);
        if (canStand(bot, point)) candidates.push({ point, score: Math.hypot(dx, dz) + Math.abs(dy) * 0.6 });
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.point || null;
}

function breakRisk(bot, block) {
  if (!block?.position) return '区块未加载';
  if (!isNatural(block)) return `不拆除 ${block.name}`;
  if (bot.pathfinder.movements?.blocksCantBreak?.has(block.type)) return '受保护方块';
  const underfoot = bot.entity.position.floored().offset(0, -1, 0);
  if (block.position.equals(underfoot)) return '不挖脚下支撑';
  const ceiling = bot.blockAt(block.position.offset(0, 1, 0));
  if (!ceiling) return '上方区块未加载';
  if (['sand', 'red_sand', 'gravel'].includes(ceiling.name)) return '上方有掉落方块';
  for (const face of FACES) {
    const neighbor = bot.blockAt(block.position.plus(face));
    if (!neighbor) return '邻接区块未加载';
    if (HAZARDS.has(neighbor.name)) return `邻近 ${neighbor.name}`;
  }
  return null;
}

function inspectTunnelStep(bot, from, to) {
  const next = vector(to);
  if (Math.abs(to.y - from.y) > 1 || Math.abs(to.x - from.x) + Math.abs(to.z - from.z) !== 1) return { safe: false, reason: '矿道必须逐格前进，楼梯每格只升降一级' };
  if (!isSupport(bot.blockAt(next.offset(0, -1, 0)))) return { safe: false, reason: '前方没有安全支撑，可能是深坑或液体' };
  const cells = [next.offset(0, 1, 0), next];
  if (to.y < from.y) cells.unshift(next.offset(0, 2, 0));
  if (to.y > from.y) cells.unshift(vector(from).offset(0, 2, 0));
  const blocks = [];
  for (const cell of cells) {
    const block = bot.blockAt(cell);
    if (!block) return { safe: false, reason: '前方区块尚未加载' };
    if (isPassable(block)) continue;
    const risk = breakRisk(bot, block);
    if (risk) return { safe: false, reason: risk };
    blocks.push(block);
  }
  return { safe: true, blocks, point: next };
}

module.exports = { HAZARDS, FACES, vector, isPassable, isSupport, isNatural, canStand, standingPoint, biomeName, findSafeGround, breakRisk, inspectTunnelStep };
