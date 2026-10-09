# `si12333/` — China pension contribution history (国家社会保险公共服务平台)

English · [中文](README.zh.md)

Reads every month of 企业职工基本养老保险 contributions from [si.12333.gov.cn](https://si.12333.gov.cn), across every 参保地 (provincial pool) and year, in one command. Read-only. You must be signed in to `si.12333.gov.cn` in the browser chrome-use drives; the site only accepts a scan with the 掌上12333 app or the e-social-security card, so a person has to do it (`chrome-use session handoff`).

## Commands

```sh
chrome-use site si12333/pension-payments                 # 1995 to this year, every pool
chrome-use site si12333/pension-payments --from 2015 --to 2023 --region 北京
```

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `si12333/pension-payments` | `[--from YEAR] [--to YEAR] [--region TEXT]` | `from` default 1995, `to` default this year, `region` keeps only pools whose name contains the text (default all). Returns `from`, `to`, `pools`, `distinct_months`, `overlapping_months`, `summary`, `rows`. |

Returned fields:

- `rows`: `{pool, period, place, employer, personal, base_est}` per month, sorted by `period` (`YYYYMM`). `personal` is the employee's share, normally 8% of the contribution base, so `base_est = personal / 0.08`. Flexible-employment months are paid differently, so `base_est` does not apply to them.
- `summary`: per pool, `months`, `first`, `last`, `personal_total`.
- `distinct_months`: how many different months have a payment.
- `overlapping_months`: months paid in two pools at once; only one counts when the pools are merged.

How it works: the site encrypts both request and response bodies, so the adapter drives the page's own query form instead of calling the API. Each query covers at most 3 years and asks which pool to show, so the adapter first reads the list of pools, then walks every pool × 3-year window and reads the result table. If the tab is not on the query page yet, the first run navigates there and returns `{status: "incomplete"}`; run it again.

## Safety / testing

- Read-only: it only fills in the query form's dates, picks a pool and clicks 查询.
- A full history is many queries (pools × 3-year windows), so a run can take minutes (the adapter's timeout is 600 s).
- The session expires after a while; the adapter then returns `{"error": "not logged in"}`. Sign in again by scan.
- If a query fails mid-way, you get `{error, partial, rows}` with the rows read so far.
- The output is personal data: employer names and contribution amounts.

## Tests

This pack has no offline tests yet; `node --test si12333/` finds nothing to run.

See [CHANGELOG](../CHANGELOG.md) for changes.
