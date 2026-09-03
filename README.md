# Claude-Bot v1-flash

> 基于 **mineflayer + DeepSeek** 的 Minecraft AI 助手机器人：中文对话、自动漫游、采矿战斗、铁砧附魔，**内置 24 套可直接复刻的建筑蓝图**。

![Node](https://img.shields.io/badge/Node.js-18%2B-blue.svg) ![Minecraft](https://img.shields.io/badge/Minecraft-1.21.x-green.svg) ![License](https://img.shields.io/badge/License-MIT-green.svg)

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
| `!enchant` | 自动附魔 |
| `!come` | 让 Bot 过来 |

随意用自然语言说话也可以，Bot 会自行判断该做什么。

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
