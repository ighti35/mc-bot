# Third-party notices

## Mineflayer crafting example

`modules/crafting.js` adapts `craftItem()` from the official Mineflayer inventory example, version 4.37.1 (commit `03eba44f3e9cb93a0f0bf69a75938246e174dc6f`):

https://github.com/PrismarineJS/mineflayer/blob/03eba44f3e9cb93a0f0bf69a75938246e174dc6f/examples/inventory.js#L128-L153

Adaptations: Chinese item aliases, output-count conversion, full-quantity recipe availability check, a four-block table search radius, task coordination, and error propagation to local chat / AI. Recipe selection, inventory interaction, and batch crafting use the installed Mineflayer implementation.

The MIT License (MIT)

Copyright (c) 2015 Andrew Kelley

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Mindcraft item goals and skill adapters

`modules/vendor/mindcraft-item-goal.js` is adapted from Mindcraft's `src/agent/npc/item_goal.js` at commit `f6a9556cf756e6bd88a75cc2fa0d5aed7599b101`:

https://github.com/mindcraft-bots/mindcraft/blob/f6a9556cf756e6bd88a75cc2fa0d5aed7599b101/src/agent/npc/item_goal.js

Changes: CommonJS dependency injection; expose the next dependency step to this application's bounded executor; use the registry's actual crafting-table requirement; replace blacklist-based pruning with lazy graph expansion, quantity-aware dependencies and positive method costs; reject cyclic dependency routes before collecting ingredients. Nearby entity hunting is enabled through mineflayer-pvp 1.3.2, used as an npm dependency under its bundled MIT license.

`modules/item-goal-data.js` and `modules/item-goal-actions.js` adapt registry/recipe/drop discovery, tool prerequisites, and the collect/craft/smelt flow from `src/utils/mcdata.js`, `src/agent/npc/utils.js`, and `src/agent/library/skills.js` at the same commit. Integration adds owner commands, inventory verification, task cancellation, bounded exploration, safe movement configuration, and fixes pickaxe-tier handling (gold is not an upgrade to iron).

MIT License

Copyright (c) 2024 Kolby Nottingham

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Iron anvil integration

`modules/anvil.js` adapts the open/input/result workflow from Mineflayer 4.37.1 `lib/plugins/anvil.js` and `examples/anvil.js`:

https://github.com/PrismarineJS/mineflayer/blob/03eba44f3e9cb93a0f0bf69a75938246e174dc6f/lib/plugins/anvil.js

The Mineflayer MIT notice above applies. Uses `bot.openAnvil`, `moveSlotItem` and `putAway`; adaptations select exact inventory slots, decode modern stored enchantments, screen compatibility, await the server's cost and output, verify withdrawal, and coordinate cancellation. It does not use the upstream local cost estimate or `combine` helper because the installed prismarine-item getter does not decode modern stored enchantments and type/NBT-based transfers cannot reliably distinguish component-based books.

## Version-pinned Minecraft data

`modules/game-data/vanilla-1.21.11.json` contains cooking/smithing mappings, acquisition metadata and Chinese names derived from the 1.21.11 summary of misode/mcmeta:

https://github.com/misode/mcmeta/tree/c976eb3b2cfcb9f205171527dec46b266afa3ac9

Sources: `data/recipe/data.json`, `data/tag/item/data.json`, `data/loot_table/data.json`, and `assets/lang/data.json`. These are Minecraft game-data identifiers and translations, separate from the Mindcraft/Mineflayer MIT-licensed source code above. Cooking and smithing mappings are used only for the matching Minecraft version; standard crafting recipes come from the connected bot's registry.
