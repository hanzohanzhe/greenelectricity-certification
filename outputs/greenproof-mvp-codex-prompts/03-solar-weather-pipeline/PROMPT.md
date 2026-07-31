# Codex任务：03 光伏与天气数据管道

请实现GreenProof MVP的光伏数据层，支持实测英国PV数据和剑桥天气驱动模型。

## 数据源

1. Open Climate Fix UK PV：
   - https://huggingface.co/datasets/openclimatefix/uk_pv
2. JRC PVGIS：
   - https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis
3. Open-Meteo Historical Weather API：
   - https://open-meteo.com/en/docs/historical-weather-api
4. 可选Met Office最近观测：
   - https://datahub.metoffice.gov.uk/docs/g/category/observations/overview

在下载前核对当前许可、商业使用限制和引用要求。

## 任务目标

1. 实现UK PV元数据读取器：
   - 根据剑桥中心坐标约 `52.2053, 0.1218` 筛选半径范围；
   - 不依赖精确家庭地址；
   - 优先30分钟累计发电量；
   - 排除`bad_data`标记区间；
   - 根据kWp归一化为Wh/kWp。
2. 不要下载整个大数据集作为默认路径。先读取元数据，选择候选系统，再只获取所需年月分区。
3. 编写候选系统评分和选择报告：
   - 距剑桥距离；
   - 数据覆盖；
   - 缺失率；
   - 容量；
   - 倾角/方向完整度；
   - 坏数据比例。
4. 实现PVGIS适配器：
   - 剑桥坐标；
   - 可配置容量、倾角、朝向和系统损耗；
   - 保存完整请求参数和响应哈希；
   - 标记为`modelled`。
5. 实现Open-Meteo适配器：
   - 获取GHI/DNI/DHI/GTI、气温和云量；
   - 输入明确的组件容量、倾角、朝向和损耗；
   - 输出小时或半小时模型电量；
   - 不将再分析或预测数据标为实测。
6. 建立简化但有测试的PV模型；如果采用第三方公式或库，记录版本和来源。
7. 实现容量缩放和削顶：
   - `Wh/kWp × targetKwp`
   - 逆变器容量上限；
   - 整数Wh及余量处理。
8. 输出：
   - 一个剑桥附近实测PV场景，如数据可用；
   - 一个剑桥天气驱动PV场景；
   - 来源和质量清单。

## 时间处理

- 源数据保留原始GMT/UTC说明。
- 内部统一UTC。
- UI显示Europe/London。
- 不得把小时模型插值后称为30分钟实测。

## 回退顺序

1. 剑桥附近实测PV；
2. East of England实测PV，并明确地理范围；
3. 剑桥PVGIS模型；
4. 剑桥Open-Meteo天气模型；
5. 本地小fixture，仅用于测试。

## 验收标准

- 能在不下载完整大数据集的情况下选择候选PV。
- 夜间发电为零或接近可解释的数值。
- 缩放前后单位和年度总量正确。
- 所有输出区分`measured`与`modelled`。
- API失败、限流和缓存路径有测试。

## 完成后

更新本模块 `LOG.md`，记录最终使用的数据源、候选系统选择、模型参数、下载范围、许可证判断和已知偏差。
