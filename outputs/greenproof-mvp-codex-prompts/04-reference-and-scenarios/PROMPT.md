# Codex任务：04 英国参考数据与场景构建

请将模块02和03的负荷、天气与光伏数据组合成稳定、可复现、可离线演示的场景包。

## 参考数据

NESO Historic Demand Data：
https://www.neso.energy/data-portal/historic-demand-data

NESO数据只能作为英国系统背景或日期选择依据，不能按比例缩小后冒充单栋建筑实测负荷。

## 任务目标

1. 实现NESO CKAN API/CSV适配器，读取：
   - Settlement Date；
   - Settlement Period；
   - National Demand；
   - Transmission System Demand；
   - 可用的太阳能/风电字段。
2. 正确处理半小时Settlement Period和DST。
3. 根据数据完整性选择以下代表日期：
   - 夏季高光伏日；
   - 冬季高需求日；
   - 普通工作日；
   - 周末。
4. 构建至少三个场景：
   - `cambridge-campus-real`：两个Cambridge Estates建筑 + 同日期可用实测PV；
   - `cambridge-weather-driven`：Elexon/剑桥建筑负荷 + 剑桥天气模型PV；
   - `uk-system-context`：现场场景 + NESO系统背景。
5. 对无法完全同日期对齐的来源：
   - 不得静默拼接；
   - 在场景manifest中记录对齐策略；
   - 优先采用同年份、同季节、同星期类型；
   - 标记为`aligned_typical_day`而非真实同日。
6. 统一到参与数据源的最粗粒度：
   - 30分钟 + 30分钟 → 30分钟；
   - 30分钟 + 1小时 → 1小时；
   - 不通过插值提高认证粒度。
7. 每个场景生成：
   - 压缩JSON；
   - 数据源清单；
   - 转换参数；
   - 质量摘要；
   - 原始与处理文件哈希；
   - 许可证和引用文本。
8. 创建场景构建CLI，例如：
   - `build-scenario --id cambridge-campus-real`
   - `validate-scenario <path>`

## 验收标准

- 所有场景可以离线加载。
- 重复构建在相同输入下产生相同内容哈希。
- 场景明确区分真实同日与典型日对齐。
- NESO数据只作为背景。
- 场景文件通过模块01 Schema。
- 每个场景包含两个租户和一个共享光伏源。

## 完成后

更新 `LOG.md`，逐一记录场景的数据来源、日期、粒度、对齐方式、缺失率、构建哈希和限制。
