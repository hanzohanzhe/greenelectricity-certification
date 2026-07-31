# 01 开发日志：项目脚手架与数据契约

- 状态：完成
- 完成时间：2026-07-31
- 技术栈：vinext 0.0.50、React 19.2.6、TypeScript 5.9.3、Python 3

## 完成内容

兼容 Sites vinext 脚手架，建立 `lib`、`data-pipeline`、`data`、`docs`、
`tests` 与版本化 `public/data`。核心契约覆盖数据源、时间序列、站点、
租户、场景、分配、manifest 与 attestation；提供 JSON Schema。

## 关键决策

内部 UTC、界面 Europe/London；能量统一非负整数 Wh；raw、processed 与
scenario 分层；provenance 属于核心值；静态 MVP 不依赖数据库。

## 测试与结果

`npm run typecheck` 通过；场景验证拒绝时间错位、负值、非整数和未知
provenance。开发与测试命令见根 README。

## 交给下一模块的信息

场景固定为一个共享 PV、两个租户；所有序列必须等长、连续、同边界。
