function isBuilding(state){return Boolean(state._buildTask||state._buildPanelTask||state.mode==='building');}
const installed=Symbol.for('mc-bot.build-movement-protection');
function installMovementProtection(bot,state){
  if(bot[installed])return;
  // Command construction has no movement goal. Ignore background movement while it owns the bot.
  if(bot.pathfinder?.setGoal){
    const setGoal=bot.pathfinder.setGoal;
    bot.pathfinder.setGoal=function(goal,...args){if(goal&&isBuilding(state))return;return setGoal.call(this,goal,...args);};
  }
  if(bot.setControlState){
    const setControlState=bot.setControlState;
    bot.setControlState=function(control,value,...args){if(value&&isBuilding(state))return;return setControlState.call(this,control,value,...args);};
  }
  bot[installed]=true;
}
module.exports={isBuilding,installMovementProtection};
