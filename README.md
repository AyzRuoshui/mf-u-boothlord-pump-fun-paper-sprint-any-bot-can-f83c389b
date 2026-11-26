[![make.fun](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/AyzRuoshui/mf-u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/rank.svg)
![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/AyzRuoshui/mf-u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/reward.svg)

# Pump.fun Paper Sprint: Any Bot Can Win

本仓库是比赛 `u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b` 的参赛交付物：一个在 Node 22 上直接运行的确定性 `pumpfun-replay/v2` 模拟交易机器人。比赛只要求一个 `main.ts`，在赛后采集的 6 小时 pump.fun 回放窗口上按净 PnL 排名；不接真实资金，也不用网络，所有决策只能来自回放输入。

## 交付物结构

- `main.ts`：完整策略逻辑，顶层 `await runBot({ onBatch })`，无构建步骤。
- `vendor/makefun-bot.ts`：官方 `sdk/ts/makefun-bot.ts` 的逐字节副本，负责解析 `hello`/`batch`/`done` 并写出 `reply`。
- `LICENSE` 与 `.makefun/freshness.json`：由 `makefun init` 在空仓库中生成后保持原样，锚点提交是其祖先。
- `README.md`：当前说明；仓库内没有其它策略文件、密钥、数据集或运行时脚本。

## 策略说明

程序从 `CreateEvent` 开始跟踪每个 mint，只在创建后 3 个 slot 内、最近 1 个 slot 有交易、至少 5 个非 creator 买家、外部买入不少于 0.1 SOL、真实 SOL 储备不少于 0.5 SOL、价格相对初始储备上涨 10% 到 500% 且 creator 没有卖出时入场。每币最多下注 0.0125 SOL，并遵守 `max_open_positions`、单批 16 单和单币 1% 真实储备上限。退出条件为 1.8% 止盈、0.9% 止损、峰值收益回吐 3% 或持仓 8 个 slot；全部使用整数与 `bigint` 计算。

## 协议与运行

回放以 NDJSON 逐行通信：第一行 `hello` 给出 seed、资金和 caps；每个 `batch` 带 slot、事件、marks、fills 和账户快照；机器人必须为每批回一行 `reply`，`done` 后不再回复。订单延迟 2 个 slot 成交，滑点设为 `10000` 仅关闭最大滑点拒绝，不绕过仓位、余额和完整性检查。

订单可由 SDK 自动分配稳定的 `client_id`；机器人不自行生成随机标识，因此两次执行的输入、输出和 action log 完全一致。

```sh
node cli/makefun.mjs grade-local --kit <kit目录> --bot <本仓库> --driver process --worktree --json
```

## 验证与实际结果

`node --check main.ts` 通过。真实 process 回放的终稿指标为 net −146,448,079 lamports、628 fills、314 个 counted round trips、最大回撤 0.014763342、胜率 0.156050955，`compliant=true`。三次回放（worktree、相对路径、commit 态）的 action log SHA256 均为 `60ddeb06e040a9fe8d1c0cb3e3f047303a6e22c89fc71fe16c1fbf6763b7304f`，L1 复现通过。协议负例探针 7/7 通过，合法请求只输出 `reply`，坏 JSON、重复 `hello`、错误类型和提前回复均被拒绝。

## 仓库边界

机器人不读时钟、环境变量、随机数、外部文件、密钥或网络；所有运行代码都在本仓库中。验证临时文件未纳入提交，提交树仅有上述五个文件；本次本地构建没有运行 `bundle`、`check`、`submit`，也没有创建远端仓库或 `push`。dev 窗口亏损不影响合规性说明，最终排名由 house 在截止后冻结的 6 小时窗口决定。
