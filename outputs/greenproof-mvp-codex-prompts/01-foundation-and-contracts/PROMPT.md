# Codex任务：01 项目脚手架与数据契约

你是一名资深全栈和数据工程师。请在当前仓库中建立 GreenProof MVP 的工程基础。

## 产品背景

GreenProof MVP 是一个使用公开真实数据驱动的多租户屋顶光伏数字孪生。一个光伏源服务两个模拟租户，系统按时间区间计算各租户的现场绿电、公共电网购电和光伏上网，并生成可追溯的演示证明。

本期不接真实电表，不发行正式绿证，不实现生产区块链、零知识证明、Daml、储能或交易市场。

## 任务目标

1. 检查现有仓库，不覆盖用户已有工作。
2. 建立清晰的单仓库结构：
   - `apps/web`：React + TypeScript + Vite；
   - `packages/contracts`：共享TypeScript类型和JSON Schema；
   - `packages/energy-engine`：后续匹配引擎；
   - `data-pipeline`：Python数据处理；
   - `data/raw`、`data/processed`、`data/scenarios`：仅保留说明和小fixture；
   - `docs/methodology`、`docs/data-sources`、`docs/dev-log`；
   - `tests/fixtures`。
3. 配置格式化、Lint、TypeScript严格模式、Vitest和Pytest。
4. 定义并实现以下核心契约：
   - `DataSourceDescriptor`
   - `TimeSeriesPoint`
   - `GenerationSeries`
   - `DemandSeries`
   - `Tenant`
   - `Site`
   - `Scenario`
   - `AllocationRule`
   - `IntervalAllocation`
   - `EvidenceManifest`
   - `Attestation`
5. 每个时间序列值至少包含：
   - `startUtc`
   - `endUtc`
   - `energyWh`，整数；
   - `provenance`
   - `qualityFlags`
   - `sourceRecordId`
6. `provenance`枚举至少包含：
   - `measured`
   - `modelled`
   - `profile_scaled`
   - `aggregated`
   - `interpolated`
   - `extrapolated`
   - `user_provided`
7. 创建一个不依赖外部网络的小型fixture，覆盖48个半小时区间、一个光伏和两个租户。
8. 编写架构决策记录，说明：
   - 为什么统一使用UTC和整数Wh；
   - 为什么原始数据与演示场景分离；
   - 为什么数据来源标签属于核心数据模型；
   - 为什么MVP不以数据库为前置条件。

## 约束

- 不添加区块链SDK。
- 不添加身份认证和数据库。
- 不提交大型数据。
- 不虚构外部数据来源。
- 如果仓库已有技术栈，优先兼容，而不是强制重建。

## 验收标准

- 前端能启动并显示一个最小占位页面。
- Python和TypeScript测试均能运行。
- JSON Schema能够验证fixture。
- 非整数Wh、时间倒序、未知provenance会被拒绝。
- README写明开发、测试和数据目录用法。

## 完成后

请运行相关测试，并更新本模块的 `LOG.md`，记录：

- 实际创建或修改的文件；
- 使用的版本和命令；
- 关键设计决策；
- 测试结果；
- 未解决问题；
- 下一模块需要注意的事项。
