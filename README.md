# Claude-Bot v1-flash

> 基于 **mineflayer + DeepSeek** 的 Minecraft AI 助手机器人：中文对话、自动漫游、采矿战斗、铁砧附魔，**内置 24 套可直接复刻的建筑蓝图**。

![Node](https://img.shields.io/badge/Node.js-18%2B-blue.svg) ![Minecraft](https://img.shields.io/badge/Minecraft-1.21.x-green.svg) ![License](https://img.shields.io/badge/License-MIT-green.svg)

当前版本：**1.2.0**。更新内容见 [CHANGELOG.md](CHANGELOG.md)。

## 功能

- **AI 对话** — 自然语言交流（中文），DeepSeek 大模型驱动
- **自动漫游** — 在主人周围自动行走探索
- **采矿/砍树** — 识别矿石和树木，自动切换工具
- **自动战斗** — 遭遇怪物自动反击
- **铁砧附魔** — 自动使用铁砧给装备附魔
- **水域生存** — 自动游泳上浮，不会溺水
- **村庄搜索** — /locate 命令 + 探索
- **联网搜索** — Bing 搜索实时信息
- **死亡分析** — 每次死亡自动分析原因
- **自由指令** — AI 可自行执行任何 MC 指令

## 环境要求

- **Node.js** >= 18（推荐 v20+）
- **Minecraft** Java Edition 1.21.x
- **DeepSeek API Key** — 在 [platform.deepseek.com](https://platform.deepseek.com) 注册获取

## 快速开始

### 1. 配置

复制配置模板并填入你的信息：

```bash
copy config.example.json config.json
```

编辑 `config.json`：

```json
{
  "host": "localhost",
  "port": 62452,
  "username": "Claude_Bot",
  "version": "1.21.11",
  "owner": "你的游戏ID",
  "aiApiKey": "sk-你的DeepSeek-API-Key",
  "aiApiUrl": "https://api.deepseek.com/v1/chat/completions",
  "aiModel": "deepseek-chat"
}
```

> 如果用其他 AI（OpenAI、Ollama 等），只需改 `aiApiUrl` 和 `aiModel`。OpenAI 兼容的 API 都支持。

### 2. 安装依赖

```bash
npm install
```

### 3. 启动 Minecraft 服务器

打开 MC 1.21.x，创建局域网世界（打开局域网），记下端口号。

> 也可以在启动器里安装 Forge/Fabric 开服。

### 4. 启动 Bot

```bash
npm start
```

### 5. 给 Bot 权限（可选）

在游戏聊天框执行：

```
/op Claude_Bot
```

这样 Bot 才能使用 `/attribute` 设置血量，以及 `/locate` 搜索结构。

## 使用

在游戏里直接和 Bot 聊天即可，Bot 会自动识别你的消息并回复。

常用命令（游戏内聊天输入）：

| 命令 | 说明 |
|------|------|
| `!help` | 查看帮助 |
| `!stop` | 停止漫游 |
| `!wander` | 开始漫游 |
| `!mine <方块>` | 采矿 |
| `!collect <物品>` | 收集掉落物 |
| `!craft <物品> [数量]` / `!合成 <物品> [数量]` | 使用背包材料合成物品 |
| `!obtain <物品> [数量]` / `!获取 <物品> [数量]` | 自动补齐采集、工具、合成和熔炼前置条件 |
| `!enchant` | 自动附魔 |
| `!come` | 让 Bot 过来 |

随意用自然语言说话也可以，Bot 会自行判断该做什么。

### 物品合成

例如 `!craft oak_planks 8`、`!craft 木棍 4`、`!craft wooden_pickaxe 1`。物品支持英文 ID（可带 `minecraft:` 前缀）及 `data/items.json` 中的中文名。

数量是**新增成品数量**，默认 1，范围 1–2304；按配方产量向上取整，例如请求 1 根木棍会合成 4 根。2×2 配方直接在背包合成；3×3 配方需要在机器人 4 格以内放置工作台。材料必须提前放入机器人的背包，不自动采集或递归合成中间材料，也不使用 `/give`。熔炼、铁砧和锻造台配方不在此功能范围内。

采用 [Mineflayer 4.37.1 官方 inventory 示例](https://github.com/PrismarineJS/mineflayer/blob/03eba44f3e9cb93a0f0bf69a75938246e174dc6f/examples/inventory.js#L128-L153) 的合成流程（MIT，见 THIRD_PARTY_NOTICES.md）。一次选择一个满足全部数量的配方并交给 Mineflayer 批量合成，不混用多个配方。材料不足时不开始；执行中失败可能已经消耗部分材料，需要检查背包。Mineflayer 没有合成取消接口，`!stop` 会提示等待当前批次完成。合成指令直接执行，不依赖 AI 接口（程序启动仍沿用现有的 API Key 配置检查）。

### 自动完成物品目标

对机器人说 **“合成一把钻石镐”**，或者输入 `!obtain diamond_pickaxe 1`。所有普通聊天均发送给配置的 AI API，由模型根据意图决定是否调用 `obtain`，再接入同一执行器。目标数量指**最终背包总量**（1–64），已拥有的物品、工具及附近工作台/熔炉会复用。

复用 [Mindcraft 的 ItemGoal 依赖规划器](https://github.com/mindcraft-bots/mindcraft/blob/f6a9556cf756e6bd88a75cc2fa0d5aed7599b101/src/agent/npc/item_goal.js)（MIT），每完成一步就重新检查背包。例如空背包制作钻石镐会经历：采集原木 → 木板/木棍/工作台 → 木镐 → 圆石 → 石镐 → 粗铁、煤炭和熔炉 → 铁锭 → 铁镐 → 钻石 → 钻石镐。执行次序可能因现有物品和可用配方调整，成功仅以目标物品进入背包为准。

机器人会逐步报告正在采集、合成或熔炼什么，并报告工作台/熔炉的放置坐标。`!status` 查看当前步骤，`!stop` 请求停止；当前 Mineflayer 合成操作结束后才释放任务。低血量、死亡、断线、步骤超时也会停止，不会用 `/give`、创造模式或传送完成目标。中断后保留已有成果，重新发送目标会从当前背包继续；熔炼中断时需要检查并取回熔炉内的原料。

资源扫描依赖已加载区块，最多搜索 128 格；找不到资源时有限次探索，地下寻路交给 Pathfinder。单步骤最多 2 分钟、整项任务最多 20 分钟/256 步，连续失败会报告缺失资源或不可达原因。当前接入注册表中的普通配方、自然方块资源、附近生物掉落，以及 1.21.11 的熔炉和锻造配方。数据覆盖 886 种普通合成产物、61 种熔炼产物和 12 种锻造产物；这不代表全部物品都能从零自动获得。交易、酿造、种植、结构宝箱搜寻和跨维度探索尚未接入，缺失的稀有材料需先提供。用 `!配方 <物品>` 查看获取方式与限制。熔炼支持煤炭、木炭及部分木制燃料，需要空熔炉；锻造需要模板、底材和添加材料。

运行 `npm test` 验证依赖链与接口适配。测试使用真实 1.21.11 配方、工具采集等级和模拟世界/背包；尚需在真实 Minecraft 服务器验证地形寻路、窗口交互和网络时序。

## 铁砧与附魔书

可以直接聊天，不需要输入命令：

```text
给钻石镐附魔效率五
帮我给钻石剑附魔锋利三
用附魔书给我的剑加锋利
给手里的装备附魔耐久三
停止附魔
```

以上只是表达示例，没有固定句式匹配。所有普通聊天都交给配置的 AI API，结合上下文理解物品、附魔和等级，再选择调用工具、回答问题或澄清歧义。附魔、物品获取、合成和停止任务均遵循此流程。API 未配置或调用失败时会提示失败，不进行本地关键词猜测。显式 `!` 命令仍可手动调用功能。每次处理一件装备、一本附魔书；这里的装备须在机器人背包里。

复用 Mineflayer 官方铁砧窗口操作流程，适配 1.21.11 的附魔书组件。将装备和附魔书放进机器人的背包，附近 64 格内放置可到达的铁砧，并准备足够经验等级：

```text
!附魔 钻石镐 效率 5
!enchant diamond_sword sharpness 3
!enchant diamond_pickaxe
!enchant
!stop
```

省略附魔名称时选择能提升该装备的附魔书；不带参数时处理手持物品。每次使用一本书，可重复执行。等级指期望的结果等级（至少），支持同级合并升级；不会自动获取附魔书或刷经验。穿戴中的装备请先放入背包。

执行前筛选兼容、无冲突且能提升等级的附魔书，精确选择书籍槽位；服务器决定实际费用和结果。经验不足、生存模式费用达到 40 级、无预期提升或操作失败时会报告原因，只有实际取回附魔装备后才报告成功。`!stop` 请求停止，在当前窗口操作结束后清理；已经完成的取出操作无法撤销。AI 的 enchant 工具同样等待结果。

测试覆盖模拟服务器费用、附魔预览、取消及失败处理；尚未连接真实服务器验证铁砧网络交互。

## 目录结构

```
mc-bot/
├── index.js              # 主入口
├── config.json           # 配置文件（需要自己创建）
├── config.example.json   # 配置模板
├── package.json
├── modules/
│   ├── ai.js             # AI 大脑（核心）
│   ├── anvil.js          # 铁砧附魔
│   ├── chat.js           # 聊天命令
│   ├── combat.js         # 战斗系统
│   ├── miner.js          # 采矿/砍树
│   ├── wander.js         # 自动漫游
│   ├── collector.js      # 收集掉落物
│   ├── builder.js        # 建筑
│   ├── death-analyzer.js # 死亡分析
│   └── web-learner.js    # 联网搜索
└── data/
    ├── items.json        # 方块映射（必需）
    ├── waypoints.json    # 路径点（运行时生成）
    ├── schematics/       # 蓝图建筑：<名字>.json 供 builder 复刻，<名字>.litematic 为可编辑源
    ├── death-reports/    # 死亡报告（运行时生成，已 gitignore）
    └── search-requests/  # 搜索记录（运行时生成，已 gitignore）
```

> `data/schematics/` 里的蓝图已随仓库分发，AI 说「盖个 神里屋敷 / 巴黎圣母院 / 樱花木屋」等即可直接复刻。
> 要是想让 Bot 认识更多建筑，往 `data/schematics/` 放一个 `<名字>.json`（逐格坐标数组）就能用。

## 自定义 AI

如果想换成其他 AI：

- **OpenAI**: 改 `aiApiUrl` 为 `https://api.openai.com/v1/chat/completions`，`aiModel` 为 `gpt-4o`
- **Ollama（本地）**: 改 `aiApiUrl` 为 `http://localhost:11434/v1/chat/completions`，`aiModel` 为 `qwen2.5` 等
- **其他兼容接口**：只要兼容 OpenAI Chat Completions API 即可

## License

MIT — 随便改，随便发。
