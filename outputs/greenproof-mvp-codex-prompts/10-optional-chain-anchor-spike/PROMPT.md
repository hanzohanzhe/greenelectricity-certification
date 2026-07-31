# Codex任务：10 可选公共链Merkle根锚定实验

这是一个可选、隔离的技术Spike。只有模块07—09已经稳定，且产品方确认需要展示链上时间锚时才执行。

## 目标

将一个演示场景的每日Merkle根写入公共测试网或本地EVM开发链，并从验证页面验证交易回执。

不发行Token，不创建NFT，不把任何用电、地址、租户或场景明文写入链上。

## 任务范围

1. 先写简短决策记录，比较：
   - 完全不使用链；
   - 本地开发链；
   - 公共EVM测试网；
   - 成熟L2测试网。
2. 未经用户授权不得申请付费服务或使用主网资金。
3. 实现最小合约：

```solidity
anchorBatch(
  bytes32 batchId,
  bytes32 merkleRoot,
  bytes32 previousRoot,
  uint16 schemaVersion
)
```

4. 防止同一`batchId`被不同根重复覆盖。
5. 记录事件：

```solidity
BatchAnchored(batchId, merkleRoot, previousRoot, schemaVersion)
```

6. `batchId`必须是随机或加盐标识，不能编码租户、地址或日期明文。
7. 增加链抽象接口，使主应用不绑定具体链：

```typescript
interface AnchorProvider {
  anchorBatch(input: AnchorInput): Promise<AnchorReceipt>;
  verifyAnchor(receipt: AnchorReceipt): Promise<boolean>;
}
```

8. 提供：
   - `NoopAnchorProvider`
   - `LocalEvmAnchorProvider`
   - 一个经批准的测试网Provider。
9. 验证页面增加：
   - 链名称；
   - 合约地址；
   - 交易哈希；
   - 区块时间；
   - 根哈希匹配状态。
10. 链不可用时，核心场景、计算和证明仍然工作，并显示`anchoring pending`。

## 隐私检查

确认链上不包含：

- 发电量；
- 负荷；
- Tenant ID；
- 站点ID；
- 地址；
- 数据源明文；
- 固定可跨场景追踪的用户标识；
- 未加盐的低熵数据哈希。

## 测试

- 正常锚定；
- 重复请求幂等；
- 同batch不同root被拒绝；
- 错误网络；
- RPC超时；
- 回执重组或未最终确认；
- 篡改Merkle根验证失败；
- 无链模式完整工作。

## 验收标准

- 主应用不依赖链才能运行。
- 链上只有最小承诺信息。
- 可从独立脚本验证交易和Merkle根。
- 测试网或本地链演示有完整复现步骤。
- 文档明确：区块链证明提交后的完整性，不证明源头数据真实。

## 完成后

更新本模块 `LOG.md`，记录选择的网络、合约地址、部署方式、交易样例、成本估算、隐私检查和是否建议进入下一阶段。
