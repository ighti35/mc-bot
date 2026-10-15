const { EventEmitter } = require('node:events');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('prismarine-registry')('1.21.11');
const injectCraft = require('mineflayer/lib/plugins/craft');

function survivalBot(initial = {}, resources = ['oak_log', 'stone', 'coal_ore', 'iron_ore', 'diamond_ore']) {
  const stock = { ...initial };
  const events = [];
  const messages = [];
  const placed = new Map();
  const bot = new EventEmitter();
  function change(name, delta) {
    stock[name] = (stock[name] || 0) + delta;
    assert.ok(stock[name] >= 0, `negative inventory: ${name}`);
  }
  function item(name, count) { return { name, type: registry.itemsByName[name].id, count }; }
  function block(name, pos = new Vec3(5, 64, 5)) {
    const def = registry.blocksByName[name];
    return { ...def, position: pos, boundingBox: name === 'air' ? 'empty' : 'block',
      canHarvest: tool => !def.harvestTools || Boolean(def.harvestTools[tool]) };
  }
  Object.assign(bot, {
    registry, health: 20, food: 20, entities: {}, heldItem: null,
    entity: { position: new Vec3(0, 64, 0) },
    inventory: {
      items: () => Object.entries(stock).filter(([, count]) => count > 0).map(([name, count]) => item(name, count)),
      count: id => stock[registry.items[id].name] || 0,
    },
    pathfinder: {
      setGoal() {},
      async goto(goal) { bot.entity.position = new Vec3(goal.x, goal.y, goal.z); },
    },
    clearControlStates() {},
    chat: text => messages.push(text),
    findBlock({ matching }) {
      const name = registry.blocks[matching]?.name;
      if (resources.includes(name)) return block(name);
      return [...placed.values()].find(b => b.name === name) || null;
    },
    blockAt(pos) {
      return placed.get(pos.toString()) || block(pos.y < 64 ? 'stone' : 'air', pos);
    },
    async equip(value) { bot.heldItem = value; },
    async placeBlock(reference, face) {
      const name = bot.heldItem.name;
      change(name, -1);
      const pos = reference.position.plus(face);
      placed.set(pos.toString(), block(name, pos));
      events.push({ type: 'place', name });
    },
    tool: {
      async equipForBlock(target) {
        bot.heldItem = bot.inventory.items().find(i => target.canHarvest(i.type)) || null;
        if (!target.canHarvest(bot.heldItem?.type ?? null)) throw Error(`wrong tool for ${target.name}`);
      },
    },
    collectBlock: {
      async collect(target) {
        assert.ok(target.canHarvest(bot.heldItem?.type ?? null), `cannot mine ${target.name}`);
        const drop = registry.items[target.drops[0]].name;
        change(drop, 1);
        events.push({ type: 'mine', name: target.name, tool: bot.heldItem?.name, drop });
      },
      async cancelTask() {},
    },
    async openFurnace() {
      let input = null;
      let output = null;
      let fuel = null;
      return {
        inputItem: () => input, outputItem: () => output, fuelItem: () => fuel,
        async putFuel(id, metadata, count) { change(registry.items[id].name, -count); fuel = item(registry.items[id].name, count); },
        async putInput(id, metadata, count) {
          const name = registry.items[id].name;
          change(name, -count);
          assert.ok(fuel && fuel.count * require('../../modules/item-goal-data').fuelOutput(fuel.name) >= count);
          output = item(Object.entries(require('../../modules/game-data/vanilla-1.21.11.json').cooking).find(([, inputs]) => inputs.includes(name))?.[0], count);
          input = null; fuel = null;
          events.push({ type: 'smelt', name, count });
        },
        async takeOutput() { const result = output; change(result.name, result.count); output = null; return result; },
        async takeFuel() { if (fuel) change(fuel.name, fuel.count); fuel = null; },
        close() {},
      };
    },
  });
  injectCraft(bot);
  bot.craft = async (recipe, count, table) => {
    assert.ok(count > 0);
    if (recipe.requiresTable) assert.equal(table?.name, 'crafting_table');
    for (const delta of recipe.delta) change(registry.items[delta.id].name, delta.count * count);
    events.push({ type: 'craft', name: registry.items[recipe.result.id].name, count: recipe.result.count * count });
  };
  return { bot, stock, events, messages, placed, state: { mode: 'idle', stats: { actionHistory: [] } } };
}
module.exports = { survivalBot };
