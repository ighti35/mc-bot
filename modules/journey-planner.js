const AStar=require('mineflayer-pathfinder/lib/astar');
const Move=require('mineflayer-pathfinder/lib/move');
const {goals:{GoalNearXZ,GoalNear}}=require('mineflayer-pathfinder');
const {standingPoint,isPassable,FACES,HAZARDS}=require('./terrain');

// Search actual movement edges, including their placement and swimming costs.
// A distant destination may lie outside loaded terrain; only execute a known prefix.
async function planJourney(bot,map,target,movements,options={},check=()=>{}) {
  const start=standingPoint(bot),radius=options.searchRadius??96;
  const goal=options.targetY===undefined
    ?new GoalNearXZ(target.x,target.z,options.range??1)
    :new GoalNear(target.x,options.targetY,target.z,options.range??1);
  const {cellKey}=require('./exploration');
  movements.placeCost=8;
  const graph={getNeighbors(node){
    return movements.getNeighbors(node).filter(next=>{
      if(!Number.isFinite(next.cost)||next.toBreak.length||next.y<start.y-12||Math.hypot(next.x-start.x,next.z-start.z)>radius)return false;
      const feet=bot.blockAt(next),head=bot.blockAt(next.offset(0,1,0)),floor=bot.blockAt(next.offset(0,-1,0));
      if(!feet||!head||!floor)return false;
      // Swim at the surface; do not plan long submerged tunnels.
      if(['water','bubble_column'].includes(feet.name)&&!isPassable(head))return false;
      return FACES.every(face=>{const block=bot.blockAt(next.plus(face));return block&&(!HAZARDS.has(block.name)||['water','bubble_column'].includes(block.name));});
    }).map(next=>{
      const memory=map.cells[cellKey(next)];
      next.cost+=Math.min(8,(memory?.visits||0)*2);
      if(memory?.status==='blocked'&&Date.now()-memory.time<30000)next.cost+=20;
      // Remaining blocks are part of a node's state, so a cheaper exhausted
      // route cannot discard an alternative that still has bridge supplies.
      next.hash+=`,${next.remainingBlocks}`;
      return next;
    });
  }};
  const first=new Move(start.x,start.y,start.z,movements.countScaffoldingItems(),0);
  first.hash+=`,${first.remainingBlocks}`;
  const search=new AStar(first,graph,goal,options.timeout??1200,20,-1);
  let result;
  do {
    check();result=search.compute();
    if(result.status==='partial')await new Promise(resolve=>setImmediate(resolve));
  } while(result.status==='partial');
  check();
  const path=result.path;
  if(!path.length)return null;
  const finish=path[path.length-1];
  // A complete detour may initially go away from the target. An incomplete
  // search must still find meaningful progress, rather than repeatedly circle.
  if(result.status!=='success'&&goal.heuristic(start)-goal.heuristic(finish)<3)return null;
  const prefix=path.slice(0,options.segmentLength??12),point=prefix[prefix.length-1];
  const gaps=prefix.reduce((count,node)=>count+node.toPlace.length,0);
  const wet=prefix.some(node=>['water','bubble_column'].includes(bot.blockAt(node)?.name));
  return {point,mode:gaps?'bridge':wet?'swim':'walk',gaps,movements,
    status:result.status,cost:result.cost,visitedNodes:result.visitedNodes,
    path:path.map(node=>({x:node.x,y:node.y,z:node.z}))};
}

module.exports={planJourney};
