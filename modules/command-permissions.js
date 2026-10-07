function denied(message='') {
  return /(?:不要|不许|不准|禁止|禁用|不能|别用|不用).{0,8}(?:指令|命令|作弊|传送)|(?:只用|必须用|纯)生存|\bno commands\b|\bno cheats\b/i.test(message);
}
function allows(message='') {
  if(denied(message)||/只有|如果|等我|吗|能不能|可不可以|能否|是否|为什么|怎么|[？?]/.test(message))return false;
  return /(?:可以|允许|准许|授权|同意|能).{0,5}(?:用|使用|执行)(?:游戏|MC|Minecraft)?(?:指令|命令)|\b(?:allow|permit) commands\b/i.test(message);
}
function active(state) {
  const grant=state?._commandAuthorization;
  return Boolean(grant&&grant.epoch===(state._commandEpoch||0));
}
function pending(state,owner) {
  const grant=state?._pendingCommandAuthorization;
  return Boolean(grant&&grant.owner===owner&&Date.now()<grant.expiresAt);
}
function restricted(state) {
  return Boolean(state?._commandRestriction&&state._commandRestriction.epoch===(state._commandEpoch||0));
}
function creative(bot,state) {
  return !state?._commandDisabled&&!restricted(state)&&[1,'creative'].includes(bot?.game?.gameMode);
}
function requireAllowed(bot,state,command) {
  if(command&&state._commandCleanupAuthorization===command)return;
  if(!restricted(state)&&(!bot._commandGuardInstalled||active(state)||creative(bot,state)))return;
  throw Object.assign(new Error('指令未授权：请由主人明确说“这次可以用指令”后再执行。'),{code:'COMMAND_NOT_AUTHORIZED'});
}
function begin(username,message,bot,state,config) {
  if(username!==config.owner)return ()=>{};
  if(denied(message)){
    state._pendingCommandAuthorization=null;
    const previous=state._commandRestriction,token={epoch:state._commandEpoch||0};
    state._commandRestriction=token;
    return ()=>{if(state._commandRestriction===token)state._commandRestriction=previous;};
  }
  if(active(state))return ()=>{};
  if(!allows(message)&&!pending(state,username))return ()=>{};
  const token={owner:username,epoch:state._commandEpoch||0};
  state._pendingCommandAuthorization=null;state._commandAuthorization=token;
  return ()=>{if(state._commandAuthorization===token)state._commandAuthorization=null;};
}
async function withAuthorization(username,message,bot,state,config,run) {
  const release=begin(username,message,bot,state,config);
  try{return await run();}finally{release();}
}
function request(username,message,state,config,bot) {
  if(username!==config.owner)return null;
  const text=message.trim();
  const revoke=/^!commands\s+(?:deny|off)\s*$/i.test(text)||/^(?:请|你|现在)?(?:禁用|关闭|取消|撤销|禁止|不要|不许|不准)(?:再)?(?:使用|用)?(?:游戏)?(?:指令|命令)(?:权限|授权)?[。！!]?\s*$/.test(text)||/^(?:请|把|将)?(?:指令|命令)(?:权限|授权)?(?:禁用|关闭|取消|撤销)[。！!]?\s*$/.test(text);
  if(revoke){state._commandDisabled=true;state._pendingCommandAuthorization=null;state._commandAuthorization=null;return '已禁用指令，后续需要你逐次明确授权。';}
  const grant=/^!commands\s+(?:allow|on)\s*$/i.test(text)||allows(text)&&/(?:指令|命令)(?:了|吧)?[。！!]?\s*$/.test(text);
  if(grant){state._commandDisabled=false;state._pendingCommandAuthorization={owner:username,expiresAt:Date.now()+10*60*1000};return '已授权下一次任务使用指令；任务结束后恢复默认规则（创造模式允许，其他模式禁用）。';}
  if(/^!commands(?:\s+status)?\s*$/i.test(text))return restricted(state)?'当前任务明确禁用了指令。':active(state)?'仅当前任务已获得指令授权。':creative(bot,state)?'当前为创造模式，默认允许使用指令。':pending(state,username)?'下一次任务已授权使用指令。':'指令默认禁用；说“这次可以用指令”可授权下一次任务。';
  return null;
}
function installCommandGuard(bot,state,config) {
  if(bot._commandGuardInstalled)return;
  config.commandsRequireAuthorization=true;config.autoCommandFallback=false;
  state._commandAuthorization=null;state._pendingCommandAuthorization=null;state._commandRestriction=null;state._commandDisabled=false;
  const chat=bot.chat,write=bot._client?.write;
  const allowed=command=>{
    try{requireAllowed(bot,state,command);return true;}
    catch(error){state._lastBlockedCommand={command,reason:error.message,time:Date.now()};bot.emit('commandBlocked',command);return false;}
  };
  bot._commandGuardInstalled=true;
  bot.chat=function(message,...args){if(typeof message==='string'&&message.trim().startsWith('/')&&!allowed(message.trim()))return false;return chat.call(bot,message,...args);};
  if(write)bot._client.write=function(name,packet,...args){
    const command=['chat_command','chat_command_signed'].includes(name)?'/'+packet.command:['chat','chat_message'].includes(name)&&packet.message?.trim().startsWith('/')?packet.message.trim():null;
    if(command&&!allowed(command))return false;
    return write.call(this,name,packet,...args);
  };
}
async function withCleanupAuthorization(state,command,run) {
  const previous=state._commandCleanupAuthorization;state._commandCleanupAuthorization=command;
  try{return await run();}finally{state._commandCleanupAuthorization=previous;}
}
module.exports={denied,allows,active,pending,restricted,creative,requireAllowed,begin,withAuthorization,request,installCommandGuard,withCleanupAuthorization};
