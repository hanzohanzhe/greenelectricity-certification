# 10 开发日志：可选链上锚定实验

- 状态：按 Gate 决策不执行链部署
- 决策时间：2026-07-31

## 技术选择

保留 `AnchorProvider` 接口和 `NoopAnchorProvider`，主应用默认
`not_enabled`。不引入 Solidity 工具链、钱包、RPC、测试网或 Token。

## 原因

01–09 的目标是验证用户是否重视本地绿电事实和证据表达；当前没有
具体依赖链上时间戳的验证方，也未确认公开披露边界。此时部署公共链
不会改善源头数据真实性，反而扩大隐私与运维面。

## 隐私检查

当前没有任何发电、负荷、Tenant/Site ID、地址或低熵 hash 上链。

## 下一阶段 Gate

仅当 pilot 明确需要第三方时间锚、批准披露模型并能描述依赖方决策时，
再实施本地 EVM → 公共测试网的隔离 spike。链上只允许随机/加盐 batch
ID、Merkle root、previous root 和 schema version。
