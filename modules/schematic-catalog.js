const mazes=[
  {name:'maze-fallout',label:'废土迷宫',aliases:['废土迷宫','辐射迷宫','大型迷宫','迷宫','fallout'],size:[105,7,105],blocks:54413,source:'fallout_maze.litematic'},
  {name:'maze-vault',label:'地下堡垒迷宫',aliases:['地下堡垒迷宫','地下堡垒','避难所迷宫','vault'],size:[105,7,105],blocks:48896,source:'vault_maze.litematic'},
  {name:'maze-catacombs',label:'地下墓穴迷宫',aliases:['地下墓穴迷宫','地下墓穴','墓穴迷宫','catacombs'],size:[80,6,80],blocks:33780,source:'catacombs_maze.litematic'},
  {name:'maze-classic',label:'经典石砖迷宫',aliases:['经典石砖迷宫','经典迷宫','石砖迷宫','classic'],size:[100,3,100],blocks:20002,source:'maze.litematic'},
];
function resolveSchematicName(name){
  if(typeof name!=='string')return name;
  const value=name.trim().toLowerCase();return [...mazes,...require('./mega-builds')].find(m=>m.name===value||m.aliases.includes(value))?.name||value;
}
module.exports={mazes,resolveSchematicName};
