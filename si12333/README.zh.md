# `si12333/` — 养老保险缴费记录（国家社会保险公共服务平台）

[English](README.md) · 中文

从 [si.12333.gov.cn](https://si.12333.gov.cn) 一次查出企业职工基本养老保险的全部月度缴费记录，覆盖所有参保地（省级统筹）和所有年份。只读。需要先在 chrome-use 控制的浏览器里登录 `si.12333.gov.cn`；网站只支持用掌上12333 App 或电子社保卡扫码，必须由人来扫（可以用 `chrome-use session handoff`）。

## 命令

```sh
chrome-use site si12333/pension-payments                 # 1995 年到今年，所有参保地
chrome-use site si12333/pension-payments --from 2015 --to 2023 --region 北京
```

## Adapter 一览

| adapter | 参数 | 返回 / 作用 |
| --- | --- | --- |
| `si12333/pension-payments` | `[--from YEAR] [--to YEAR] [--region TEXT]` | `from` 默认 1995，`to` 默认今年，`region` 只保留名称里包含这段文字的参保地（默认全部）。返回 `from`、`to`、`pools`、`distinct_months`、`overlapping_months`、`summary`、`rows`。 |

返回字段：

- `rows`：每月一条 `{pool, period, place, employer, personal, base_est}`，按 `period`（`YYYYMM`）排序。`personal` 是个人缴纳部分，一般是缴费基数的 8%，所以 `base_est = personal / 0.08`。灵活就业的月份缴费方式不同，`base_est` 对它们不适用。
- `summary`：按参保地汇总的 `months`、`first`、`last`、`personal_total`。
- `distinct_months`：有缴费记录的不同月份数。
- `overlapping_months`：同一个月在两个参保地都有缴费的月份；转移合并时只算一份。

实现方式：网站对请求和响应都加了密，所以 adapter 不调接口，而是操作页面自己的查询表单。每次查询最多跨 3 年，并且要选参保地，所以 adapter 先读出参保地列表，再按「参保地 × 3 年区间」逐个查询并读结果表格。如果标签页还不在查询页，第一次运行会先跳过去并返回 `{status: "incomplete"}`，再跑一次即可。

## 安全与测试

- 只读：只会填查询日期、选参保地、点「查询」。
- 完整历史要查很多次（参保地数 × 3 年区间数），一次可能要几分钟（adapter 超时设为 600 秒）。
- 登录一段时间后会失效，这时返回 `{"error": "not logged in"}`，重新扫码登录。
- 中途某次查询失败时，返回 `{error, partial, rows}`，带着已经读到的记录。
- 输出是个人数据：包含单位名称和缴费金额。

## 测试

这个包还没有离线测试，`node --test si12333/` 不会跑任何用例。

改动记录见 [CHANGELOG](../CHANGELOG.md)。
