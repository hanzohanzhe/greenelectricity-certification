# Codex任务：05 多租户匹配与分配引擎

请实现一个纯函数、可复现、可审计的共享屋顶光伏匹配引擎。它接收一个光伏时间序列和两个租户负荷时间序列，输出每个区间的现场消纳、购电、上网和租户分配。

## 核心公式

对区间`t`：

```text
totalDemand = demandA + demandB
onsiteMatched = min(generation, totalDemand)
export = max(generation - totalDemand, 0)
import = max(totalDemand - generation, 0)
```

默认按同时负荷比例分配：

```text
allocationA = onsiteMatched × demandA / totalDemand
allocationB = onsiteMatched - allocationA
```

必须使用整数Wh和确定性的最大余数法处理舍入，确保每个区间严格守恒。

## 分配规则

至少实现：

1. `pro_rata_demand_v1`：按同时负荷比例；
2. `priority_v1`：按配置顺序优先满足租户；
3. `contract_share_v1`：按固定份额分配，但不得超过各租户区间负荷，剩余量重新分配或上网。

每个结果必须记录规则ID和版本。

## 约束

每个区间必须满足：

```text
allocationA + allocationB = onsiteMatched
onsiteMatched + export = generation
allocationA <= demandA
allocationB <= demandB
tenantGridA = demandA - allocationA
tenantGridB = demandB - allocationB
tenantGridA + tenantGridB = import
```

所有量均不得为负。

## 数据质量处理

- 任一关键输入缺失时，不产生正式匹配结果；
- 可以产生`provisional`结果，但必须携带质量标记；
- 不允许用零静默替代缺失；
- 粒度不一致时拒绝运行，要求场景构建器先统一；
- 重复区间、重叠区间和时间空洞必须报错。

## 输出

- 区间结果；
- 每日/月度/年度汇总；
- 每个租户现场绿电量；
- 每个租户现场绿电占负荷比例；
- 光伏自消纳率；
- 总上网和总购电；
- 分配规则元数据；
- 输入和输出内容哈希接口。

## 测试

除示例测试外，加入属性测试，随机生成非负输入并验证所有守恒式。覆盖：

- 零发电；
- 零负荷；
- 发电大于总负荷；
- 发电小于总负荷；
- 单一租户零负荷；
- 1Wh舍入；
- 固定份额超出租户负荷；
- 缺失和时间不对齐；
- 大数值和全年数据。

## 验收标准

- 引擎不依赖UI、网络或数据库。
- 相同输入、规则和版本始终得到字节级一致输出。
- 每一Wh最多分配一次。
- 属性测试通过。
- 方法学文档包含公式、舍入和规则差异。

## 完成后

更新本模块 `LOG.md`，记录规则实现、舍入策略、测试数量、发现的边界问题和算法版本。
