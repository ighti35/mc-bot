// Adapted from Mindcraft src/agent/npc/item_goal.js (MIT).
// Commit f6a9556cf756e6bd88a75cc2fa0d5aed7599b101; see THIRD_PARTY_NOTICES.md.
// Changes: CommonJS dependency injection; actual recipe.requiresTable;
// bounded execution/exploration is provided by our Mineflayer adapter.
module.exports = function createItemGoal({ skills, world, mc, itemSatisfied }) {
class ItemNode {
    constructor(manager, wrapper, name) {
        this.manager = manager;
        this.wrapper = wrapper;
        this.name = name;
        this.type = '';
        this.source = null;
        this.prereq = null;
        this.recipe = [];
        this.fails = 0;
    }

    setRecipe(recipe, requiresTable, yieldCount=1) {
        this.yieldCount = yieldCount;
        this.type = 'craft';
        let size = 0;
        this.recipe = [];
        for (let [key, value] of Object.entries(recipe)) {
            this.manager.node(key);
            this.recipe.push({node: this.manager.nodes[key], quantity: value});
            size += value;
        }
        if (requiresTable) {
            this.manager.node('crafting_table');
            this.prereq = this.manager.nodes['crafting_table'];
        }
        return this;
    }

    setCollectable(source=null, tool=null) {
        this.type = 'block';
        if (source)
            this.source = source;
        else
            this.source = this.name;
        if (tool) {
            this.manager.node(tool);
            this.prereq = this.manager.nodes[tool];
        }
        return this;
    }

    setSmeltable(source_item, fuel) {
        this.type = 'smelt';
        this.prereq = this.manager.node('furnace');
        this.recipe = [
            {node: this.manager.node(source_item), quantity: 1},
            {node: this.manager.node(fuel), quantity: fuel === 'stick' ? 2 : 1}
        ];
        this.fuel = fuel;
        return this;
    }

    setSmithing(recipe) {
        this.type = 'smith';
        this.prereq = this.manager.node('smithing_table');
        this.details = recipe;
        this.recipe = Object.values(recipe).map(name => ({node: this.manager.node(name), quantity: 1}));
        return this;
    }

    setHuntable(animal_source) {
        this.type = 'hunt';
        this.source = animal_source;
        return this;
    }

    getChildren(quantity=1) {
        const have = world.getInventoryCounts(this.manager.agent.bot)[this.name] || 0;
        const times = Math.max(1, Math.ceil((quantity - have) / (this.yieldCount || 1)));
        const grouped = new Map();
        for (const child of this.recipe) {
            const entry = grouped.get(child.node.name);
            if (entry) entry.quantity += child.quantity * times;
            else grouped.set(child.node.name, {...child, quantity: child.quantity * times});
        }
        let children = [...grouped.values()];
        if (this.prereq) {
            const consumed = grouped.get(this.prereq.name);
            if (consumed) {
                // A workstation used as an ingredient must remain in inventory
                // in addition to the workstation placed for the operation.
                const bot = this.manager.agent.bot;
                const id = bot.registry.blocksByName[this.prereq.name]?.id;
                if (id && !bot.findBlock({ matching: id, maxDistance: 32 })) consumed.quantity++;
            }
            children.push({node: this.prereq, quantity: 1, prerequisite: true});
        }
        return children;
    }

    isReady(quantity=1) {
        for (let child of this.getChildren(quantity)) {
            if (!child.node.isDone(child.quantity, child.prerequisite)) {
                return false;
            }
        }
        return true;
    }

    isDone(quantity=1) {
        if (this.manager.goal.name === this.name)
            return false;
        return itemSatisfied(this.manager.agent.bot, this.name, quantity);
    }

    getDepth(q=1) {
        if (this.isDone(q)) {
            return 0;
        }
        let depth = 0;
        for (let child of this.getChildren()) {
            depth = Math.max(depth, child.node.getDepth(child.quantity));
        }
        return depth + 1;
    }

    getFails(q=1) {
        if (this.isDone(q)) {
            return 0;
        }
        let fails = 0;
        for (let child of this.getChildren()) {
            fails += child.node.getFails(child.quantity);
        }
        return fails + this.fails;
    }

    getNext(q=1, path=new Set()) {
        if (this.isDone(q))
            return null;
        if (this.isReady(q))
            return {node: this, quantity: Math.max(1, q - (world.getInventoryCounts(this.manager.agent.bot)[this.name] || 0))};
        let first = null;
        for (let child of this.getChildren(q)) {
            if (child.node.isDone(child.quantity, child.prerequisite)) continue;
            const res = child.node.getNext(child.quantity, path);
            // Every dependency must have an acyclic route before collecting any
            // ingredient, otherwise recycling recipes chase unrelated materials.
            if (!res) return null;
            first ||= res;
        }
        return first;
    }

    async execute(quantity=1) {
        if (!this.isReady()) {
            this.fails += 1;
            return;
        }
        let inventory = world.getInventoryCounts(this.manager.agent.bot);
        let init_quantity = inventory[this.name] || 0;
        if (this.type === 'block') {
            await skills.collectBlock(this.manager.agent.bot, this.source, quantity, this.manager.agent.npc.getBuiltPositions(), this.name);
        } else if (this.type === 'smelt') {
            let to_smelt_name = this.recipe[0].node.name;
            let to_smelt_quantity = Math.min(quantity, inventory[to_smelt_name] || 1);
            await skills.smeltItem(this.manager.agent.bot, to_smelt_name, to_smelt_quantity, this.name, this.fuel);
        } else if (this.type === 'smith') {
            await skills.smithItem(this.manager.agent.bot, this.name, this.details, quantity);
        } else if (this.type === 'hunt') {
            for (let i=0; i<quantity; i++) {
                const res = await skills.attackNearest(this.manager.agent.bot, this.source);
                if (!res || this.manager.agent.bot.interrupt_code)
                    break;
            }
        } else if (this.type === 'craft') {
            await skills.craftRecipe(this.manager.agent.bot, this.name, quantity);
        }
        let final_quantity = world.getInventoryCounts(this.manager.agent.bot)[this.name] || 0;
        if (final_quantity <= init_quantity) {
            this.fails += 1;
        }
    }
}


// Keep upstream ItemNode actions; evaluate the dependency graph with positive costs.
// This replaces upstream's item blacklist and parent-chain pruning, which rejected
// valid block<->ingot and stock-backed recipes. Positive costs cannot select cycles.
class ItemWrapper {
    constructor(manager, name) { this.manager = manager; this.name = name; this.methods = []; this.expanded = false; }
    createChildren() {
        if (this.expanded) return;
        this.expanded = true;
        for (const [recipe, details] of mc.getItemCraftingRecipes(this.name))
            this.methods.push(new ItemNode(this.manager, this, this.name).setRecipe(recipe, details.requiresTable, details.craftedCount));
        for (const source of mc.getItemBlockSources(this.name))
            this.methods.push(new ItemNode(this.manager, this, this.name).setCollectable(source, mc.getBlockTool(source, this.name)));
        for (const source of mc.getItemSmeltingIngredients(this.name))
            for (const fuel of mc.getFuels())
                this.methods.push(new ItemNode(this.manager, this, this.name).setSmeltable(source, fuel));
        for (const recipe of mc.getSmithingRecipes(this.name))
            this.methods.push(new ItemNode(this.manager, this, this.name).setSmithing(recipe));
        for (const source of mc.getItemAnimalSources(this.name))
            this.methods.push(new ItemNode(this.manager, this, this.name).setHuntable(source));
    }
    isDone(q=1, prerequisite=false) {
        return this.manager.goal.name !== this.name && itemSatisfied(this.manager.agent.bot, this.name, q, prerequisite);
    }
    getNext(q=1, path=new Set()) {
        if (this.isDone(q) || path.has(this.name)) return null;
        const nextPath = new Set([...path, this.name]);
        const methods = this.methods.filter(m => Number.isFinite(this.manager.scores.get(m)))
            .sort((a,b) => this.manager.scores.get(a) - this.manager.scores.get(b));
        for (const method of methods) {
            const next = method.getNext(q, nextPath);
            if (next) return next;
        }
        return null;
    }
}

class ItemGoal {
    constructor(agent) { this.agent = agent; this.nodes = {}; this.goal = null; this.best = new Map(); this.scores = new Map(); }
    node(name) {
        if (!this.nodes[name]) this.nodes[name] = new ItemWrapper(this, name);
        return this.nodes[name];
    }
    next(name, quantity=1) {
        this.goal = this.node(name);
        this.goal.createChildren();
        // Ready recipes need no acquisition graph; supplied rare ingredients are valid leaves.
        const ready = this.goal.methods.find(method => ['craft', 'smelt', 'smith'].includes(method.type) && method.isReady(quantity));
        if (ready) return ready.getNext(quantity);
        // Expansion is iterative so reverse recipes cannot recurse during construction.
        for (;;) {
            const pending = Object.values(this.nodes).filter(n => !n.expanded);
            if (!pending.length) break;
            for (const node of pending) node.createChildren();
        }
        this.best.clear();
        this.scores.clear();
        const nodes = Object.values(this.nodes);
        const cost = new Map(nodes.map(n => [n.name, Infinity]));
        const sourceCosts = new Map();
        for (let pass=0; pass <= nodes.length; pass++) {
            let changed = false;
            for (const node of nodes) {
                for (const method of node.methods) {
                    const children = method.getChildren();
                    const weights = children.map(child => child.node.isDone(child.quantity, child.prerequisite) ? 0 : cost.get(child.node.name));
                    const sourceKey = method.type + ':' + method.source;
                    if (!sourceCosts.has(sourceKey)) sourceCosts.set(sourceKey, mc.sourceCost(method.type, method.source));
                    const score = 1 + method.fails + sourceCosts.get(sourceKey) + Math.max(0, ...weights);
                    this.scores.set(method, score);
                    if (score < cost.get(node.name)) {
                        cost.set(node.name, score);
                        this.best.set(node.name, method);
                        changed = true;
                    }
                }
            }
            if (!changed) break;
        }
        return this.goal.getNext(quantity);
    }
}
return ItemGoal;
};
