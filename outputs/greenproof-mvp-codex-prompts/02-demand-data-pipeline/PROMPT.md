# Codex任务：02 剑桥建筑与英国负荷数据管道

请基于模块01的数据契约，实现GreenProof MVP的租户负荷数据管道。

## 权威/优先数据源

1. Cambridge University Estates Building Energy Archive：
   - https://github.com/EECi/Cambridge-Estates-Building-Energy-Archive
   - https://zenodo.org/records/10708694
2. Elexon Profiling：
   - https://www.elexon.co.uk/bsc/settlement/profiling/
3. UKERC发布的Elexon标准半小时Profile：
   - https://ukerc.rl.ac.uk/cgi-bin/dataDiscover.pl?Action=detail&dataid=5af8ae29-86a7-4e8c-9fe4-1e2d99d9fb96
4. DESNZ ND-NEED：
   - https://www.gov.uk/government/statistics/non-domestic-national-energy-efficiency-data-framework-nd-need-2025

先核对当前下载地址、许可证和数据结构；不要假定网页长期不变。

## 任务目标

1. 建立可重复运行的下载和缓存机制。
2. 下载或读取Cambridge Estates数据元数据，分析：
   - 建筑ID；
   - 可用年份；
   - 时间粒度；
   - 缺失率；
   - 年度总用电；
   - 日夜负荷比；
   - 工作日/周末差异。
3. 自动推荐两栋在同一年有重叠数据且形状不同的匿名建筑：
   - Tenant A：明显白天型；
   - Tenant B：较高基础负荷型。
4. 不要把缺失值自动填零后当作实测。仓库源数据若已将缺失替换为零，应读取其处理说明，并将可疑区间标记为质量问题。
5. 实现Elexon Profile适配器，至少支持：
   - PC1 Domestic Unrestricted；
   - PC3 Non-domestic Unrestricted；
   - 工作日、周六、周日；
   - 春、夏、盛夏、秋、冬。
6. 实现年度消费量缩放：
   - 输入年度kWh；
   - 输出半小时Wh；
   - 全年合计误差不超过1Wh或明确说明舍入余量处理。
7. 将ND-NEED仅用于年度规模标定或基准比较，不用于伪造具体建筑实测曲线。
8. 输出统一Parquet及一个小型JSON fixture。
9. 生成数据源清单，记录：
   - 来源；
   - 版本；
   - 许可证；
   - 下载时间；
   - 原文件SHA-256；
   - 处理步骤；
   - 已知限制。

## 数据质量规则

至少检测：

- 重复时间戳；
- 时间倒序；
- 缺失区间；
- 负电量；
- 长时间连续零值；
- 异常尖峰；
- 英国夏令时的46、48、50个半小时区间；
- 年度数据不完整。

## 回退路径

如果Cambridge Estates下载失败：

- 使用仓库内小fixture继续开发；
- 保留可重试下载脚本；
- 不静默切换到人工曲线；
- 在输出manifest中标记数据未获取。

## 验收标准

- 能生成两个租户在相同时间轴上的负荷序列。
- 能解释为什么选择这两个建筑。
- 实测与profile-scaled数据标签正确。
- 所有源文件和处理结果均可通过哈希核对。
- 测试覆盖DST、缺失、缩放守恒和异常零值。

## 完成后

运行测试并更新本模块 `LOG.md`，特别记录最终选中的匿名建筑ID、年份、粒度、缺失率和许可证判断。
