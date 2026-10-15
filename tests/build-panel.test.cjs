const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter,once}=require('node:events'),{Vec3}=require('vec3');
const build=require('../modules/build-panel'),permissions=require('../modules/command-permissions');
const {stopCurrentTask}=require('../modules/task-control'),{startInventoryPanel}=require('../modules/inventory-panel');
function fixture(){const bot=new EventEmitter(),state={mode:'idle'},config={owner:'Owner',username:'Claude_Bot',port:52591};Object.assign(bot,{username:'Claude_Bot',game:{gameMode:'creative',dimension:'overworld',minY:-64,height:384},_client:{state:'play',write(){}},entity:{position:new Vec3(0,64,0)},pathfinder:{setGoal(){}},clearControlStates(){},stopDigging(){},chat(){}});permissions.installCommandGuard(bot,state,config);return {bot,state,config};}
const body={viewer:'Owner',action:'build',id:'maze-fallout',position:{x:10,y:70,z:20},size:5};
const entry=async()=>({label:'废土迷宫',size:{x:105,y:7,z:105}});
test('catalog includes every real schematic and basic design with Chinese labels and bounded actual-block previews',async()=>{
  const items=await build.catalog();assert.equal(items.length,35);assert.deepEqual(items.filter(i=>i.error).map(i=>i.id).sort(),['leyndell']);
  for(const item of items){assert(/[\u4e00-\u9fff]/.test(item.label));if(item.error){assert.match(item.label,/未就绪/);continue;}assert(item.preview.width<=40);assert.equal(item.preview.cells.length,item.preview.width*item.preview.depth);}
  assert.equal((await build.entry('house',8)).parameterSize,8);
});
test('an owner click dispatches selected coordinates and an explicit cleanup choice, reserving the entire awaited task',async()=>{
  const f=fixture();let resolveTask,received;
  const accepted=await build.action(()=>f,{...body,clearTerrain:true},{entry,startBuilder(args,bot,state,options){received={args,options};return new Promise(r=>resolveTask=r);}});
  assert(accepted.accepted);assert.deepEqual(received.options.position,body.position);assert.equal(received.options.clearTerrain,true);assert(received.args.includes('--new'));
  await assert.rejects(build.action(()=>f,body,{entry}),{status:409});resolveTask({message:'finished'});await new Promise(r=>setImmediate(r));assert.equal(f.state._buildPanelTask,null);
});
test('survival cannot build without explicit authorization and one click grant expires on failure',async()=>{
  const f=fixture();f.bot.game.gameMode='survival';let started=0;
  const dependencies={entry,startBuilder(){started++;return Promise.reject(new Error('occupied'));}};
  await assert.rejects(build.action(()=>f,body,dependencies),{code:'COMMAND_NOT_AUTHORIZED'});assert.equal(started,0);
  await build.action(()=>f,{...body,allowCommands:true},dependencies);await new Promise(r=>setImmediate(r));assert.equal(started,1);assert(!permissions.active(f.state));assert.equal(f.state._lastBuildResult.success,false);
});
test('stop while catalog is loading cancels the pending click without starting a build',async()=>{
  const f=fixture();let resolveEntry,started=false;
  const request=build.action(()=>f,body,{entry:()=>new Promise(r=>resolveEntry=r),startBuilder(){started=true;}});
  stopCurrentTask(f.bot,f.state);resolveEntry(await entry());await assert.rejects(request,{status:409});assert.equal(started,false);
});
test('unauthorized viewers and invalid positions fail before any task starts',async()=>{
  const f=fixture();await assert.rejects(build.action(()=>f,{...body,viewer:'Other'}),{status:403});
  await assert.rejects(build.action(()=>f,{...body,position:{x:1.5,y:64,z:0}}),{status:400});
  await assert.rejects(build.action(()=>f,{...body,position:{x:0,y:319,z:0}},{entry}),/超出世界高度/);assert.equal(f.state._buildPanelTask,null);
});
test('game HTTP handshake rejects browser origins, missing tokens and non-owner identities',async t=>{
  const f=fixture(),server=startInventoryPanel(()=>f,{port:0});await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/build/session')).status,403);
  const headers={'X-Bot-Game-Client':'building-menu','X-Bot-Viewer':'Owner'};
  assert.equal((await fetch(base+'/api/build/session',{headers:{...headers,Origin:'http://bad.example'}})).status,403);
  const session=await(await fetch(base+'/api/build/session',{headers})).json();assert(session.token);
  const post={method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({viewer:'Owner',action:'stop'})};
  assert.equal((await fetch(base+'/api/build/action',post)).status,403);
  post.headers['X-Panel-Token']=session.token;assert.equal((await fetch(base+'/api/build/action',post)).status,202);
});
