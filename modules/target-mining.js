const { vector, inspectTunnelStep } = require('./terrain');
const key = p => `${p.x},${p.y},${p.z}`;

function scanTargets(bot, names, { radius = 32, excluded = new Set(), count = 64 } = {}) {
  return bot.findBlocks({
    matching: block => Boolean(block) && names.includes(block.name),
    useExtraInfo: block => Boolean(block?.position) && !excluded.has(key(block.position)),
    maxDistance: radius, count,
  }).filter(point => names.includes(bot.blockAt(point)?.name))
    .sort((a,b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
}

class Queue {
  constructor() { this.items = []; }
  push(node) {
    const items=this.items;items.push(node);let i=items.length-1;
    while(i>0){const parent=(i-1)>>1;if(items[parent].score<=node.score)break;items[i]=items[parent];i=parent;}items[i]=node;
  }
  pop() {
    const items=this.items,first=items[0],last=items.pop();
    if(items.length){let i=0;while(i*2+1<items.length){let child=i*2+1;if(child+1<items.length&&items[child+1].score<items[child].score)child++;if(last.score<=items[child].score)break;items[i]=items[child];i=child;}items[i]=last;}return first;
  }
}

async function planTargetTunnel(bot, from, target, { assertActive = () => {}, blockedEdges = new Set(), maxNodes = 4000, margin = 8, timeout = 1500 } = {}) {
  const deadline=Date.now()+timeout;
  from=vector(from);target=vector(target);
  // The ore will be in the feet or head clearance of the final tunnel cell.
  const goals=[target,target.offset(0,-1,0)];
  const heuristic=p=>Math.min(...goals.map(g=>Math.max(Math.abs(p.x-g.x)+Math.abs(p.z-g.z),Math.abs(p.y-g.y))));
  const open=new Queue(),best=new Map([[key(from),0]]),parents=new Map(),points=new Map([[key(from),from]]);
  const bounds={minX:Math.min(from.x,target.x)-margin,maxX:Math.max(from.x,target.x)+margin,minZ:Math.min(from.z,target.z)-margin,maxZ:Math.max(from.z,target.z)+margin,
    minY:Math.max((bot.game?.minY??-64)+1,Math.min(from.y,target.y)-margin),maxY:Math.min((bot.game?.minY??-64)+(bot.game?.height??384)-2,Math.max(from.y,target.y)+margin)};
  open.push({point:from,cost:0,score:heuristic(from)});
  let examined=0;
  while(open.items.length && examined<maxNodes){
    if(examined%128===0){assertActive();await new Promise(resolve=>setImmediate(resolve));assertActive();if(Date.now()>deadline)return {path:null,examined,reason:'目标路线规划超时，先继续矿道推进'};}
    const node=open.pop(),id=key(node.point);
    if(node.cost!==best.get(id))continue;
    examined++;
    if(goals.some(g=>g.equals(node.point))){
      const path=[];let cursor=id;
      while(cursor!==key(from)){path.push(points.get(cursor));cursor=parents.get(cursor);}path.reverse();
      return {path,examined};
    }
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]])for(const dy of [0,-1,1]){
      const next=node.point.offset(dx,dy,dz),nextId=key(next);
      if(next.x<bounds.minX||next.x>bounds.maxX||next.z<bounds.minZ||next.z>bounds.maxZ||next.y<bounds.minY||next.y>bounds.maxY||blockedEdges.has(`${id}>${nextId}`))continue;
      const inspection=inspectTunnelStep(bot,node.point,next);
      if(!inspection.safe)continue;
      const cost=node.cost+1+inspection.blocks.length*.35+Math.abs(dy)*.2;
      if(cost>=(best.get(nextId)??Infinity))continue;
      best.set(nextId,cost);parents.set(nextId,id);points.set(nextId,next);
      open.push({point:next,cost,score:cost+heuristic(next)});
    }
  }
  return {path:null,examined,reason:examined>=maxNodes?'路线规划达到搜索上限':'没有已加载的安全矿道路线'};
}

module.exports={scanTargets,planTargetTunnel,key};
