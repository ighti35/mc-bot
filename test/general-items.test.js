const test = require('node:test');
const assert = require('node:assert/strict');
const { survivalBot } = require('./helpers/survival-bot.cjs');
const { obtainItem } = require('../modules/item-goal');
const { createData, itemSatisfied, fuelOutput, describeItem } = require('../modules/item-goal-data');
const vanilla = require('../modules/game-data/vanilla-1.21.11.json');
const names = require('../modules/item-names');
const registry = require('prismarine-registry')('1.21.11');
const recipeData = createData(survivalBot().bot);

const craftables = Object.keys(registry.itemsByName).filter(name => recipeData.getItemCraftingRecipes(name).length);
for (const name of craftables) {
  test(`stock-backed vanilla recipe: ${name}`, async () => {
    const [ingredients] = recipeData.getItemCraftingRecipes(name)[0];
    const f = survivalBot({ ...ingredients, crafting_table: (ingredients.crafting_table || 0) + (name === 'crafting_table' ? 0 : 1) }, []);
    await obtainItem(name, 1, f.bot, f.state, { maxSteps: 1 });
    assert.ok(f.stock[name] >= 1, name);
    assert.ok(f.events.some(e => e.type === 'craft' && e.name === name));
    assert.ok(!f.events.some(e => e.type === 'mine'));
  });
}

for (const [output, inputs] of Object.entries(vanilla.cooking)) {
  test(`vanilla smelting: ${output}`, async () => {
    const input = inputs[0];
    const f = survivalBot({ [input]: 1, coal: 1, furnace: 1 }, []);
    let result = null;
    f.bot.openFurnace = async () => ({
      inputItem: () => null, fuelItem: () => null, outputItem: () => result,
      async putFuel(id, metadata, count) { const name=registry.items[id].name; assert.ok(f.stock[name]>=count); f.stock[name]-=count; },
      async putInput(id, metadata, count) { assert.equal(registry.items[id].name,input); f.stock[input]-=count; result={name:output,count}; },
      async takeOutput() { const item=result; f.stock[output]=(f.stock[output]||0)+item.count; result=null; return item; },
      close() {},
    });
    await obtainItem(output, 1, f.bot, f.state, { maxSteps: 1 });
    assert.equal(f.stock[output],1);
  });
}

for (const [output, recipes] of Object.entries(vanilla.smithing)) {
  test(`vanilla smithing with template consumption: ${output}`, async () => {
    const recipe=recipes[0];
    const stock=Object.fromEntries(Object.values(recipe).map(n=>[n,1]));
    const f=survivalBot({...stock,smithing_table:1},[]);
    const window={type:'minecraft:smithing', slots:Array(40).fill(null), close(){}};
    f.bot.openBlock=async()=>window;
    f.bot.transfer=async options=>{
      const name=registry.items[options.itemType].name;
      assert.ok(f.stock[name]>=1); f.stock[name]--;
      window.slots[options.destStart]={name,count:1};
      if(window.slots.slice(0,3).every(Boolean))window.slots[3]={name:output,count:1};
    };
    f.bot.putAway=async slot=>{assert.equal(slot,3);f.stock[output]=1;window.slots.fill(null,0,4);};
    await obtainItem(output,1,f.bot,f.state,{maxSteps:1});
    assert.equal(f.stock[output],1);
    assert.equal(f.stock[recipe.template],0);
    assert.equal(window.inventoryStart,4);
    assert.equal(window.inventoryEnd,40);
  });
}

test('full Chinese names resolve tools, armor, food and netherite',()=>{
  for(const name of ['钻石剑','钻石斧','钻石锹','钻石锄','下界合金镐','下界合金胸甲','烤马铃薯','橡木船','红色染料'])assert.ok(registry.itemsByName[names[name]],name);
});

test('higher tools and placed workstations substitute only for prerequisites, never ingredients',()=>{
  const f=survivalBot({netherite_pickaxe:1});
  assert.equal(itemSatisfied(f.bot,'diamond_pickaxe',1),false);
  assert.equal(itemSatisfied(f.bot,'diamond_pickaxe',1,true),true);
});

test('hunting uses mineflayer-pvp, then verifies picked-up drops',async()=>{
  const f=survivalBot({},[]);
  const position=f.bot.entity.position;
  f.bot.entities[1]={id:1,name:'cow',position,isValid:true};
  f.bot.pvp={attack(entity){delete f.bot.entities[entity.id];f.bot.entities[2]={id:2,name:'item',position};},async stop(){}};
  f.bot.collectBlock.collect=async targets=>{assert.equal(targets[0].id,2);f.stock.leather=1;delete f.bot.entities[2];};
  await obtainItem('leather',1,f.bot,f.state,{maxSteps:1});
  assert.equal(f.stock.leather,1);
});

test('reverse compression recipes do not consume and recreate the same ingot forever',async()=>{
  const f=survivalBot({iron_ingot:1});
  await obtainItem('iron_pickaxe',1,f.bot,f.state,{maxSteps:64});
  assert.equal(f.stock.iron_pickaxe,1);
  assert.ok(f.events.filter(e=>e.name==='iron_nugget').length<3);
});

test('unknown acquisition route reports prerequisite rather than fabricating items',async()=>{
  const f=survivalBot({},[]);
  await assert.rejects(obtainItem('command_block',1,f.bot,f.state),/前置获取路线未满足/);
  assert.equal(f.stock.command_block,undefined);
  assert.match(describeItem(f.bot,'elytra'),/战利品|特殊交互/);
});
