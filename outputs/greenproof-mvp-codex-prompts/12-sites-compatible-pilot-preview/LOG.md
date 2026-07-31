# 12 开发日志：Sites-compatible Pilot 私有预览

- 状态：待执行
- 创建时间：2026-07-31
- 关联模块：09 部署与 Pilot 演示包、11 EvidencePackage UI

## 目标

- 建立已验证的 3B Git 检查点；
- 审查并修复 Sites-compatible 构建问题；
- 提供 Codex 内可继续调试的本地网页；
- 账户允许时只保存私有 Sites 版本，不公开发布；
- 为模块 13 前端 Pilot 打磨建立稳定候选。

## 明确边界

- 本模块不公开部署；
- 不部署 Cloudflare；
- 不加入真实数据、数据库、登录、上传或链上能力；
- 不改变匹配、Evidence 或 Merkle 算法。
