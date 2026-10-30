# 禅道 Bug 处理

[English](README.md) · 中文

本包面向自建禅道 `zentao.pwtk.cc`。先在 Chrome 登录，适配器会复用浏览器登录态，
不保存密码或 API token。运行 `chrome-use site update` 安装，不用先执行 `open`。

## 命令

| 适配器 | 必填参数 | 可选参数 | 返回 |
| --- | --- | --- | --- |
| `zentao/bugs` | 无 | `product`、`assigned`、`status`、`limit` | Bug 列表、账号、总数及查询完整性 |
| `zentao/bug` | `id` | 无 | 正文、附件、流转记录及去重后的截图 |
| `zentao/bug-image` | `id`、`image` | 无 | 已验证的 `image_url`、`image_uid` |
| `zentao/bug-comment` | `id`、`comment` | `image_url`、`image_uid` | 已回读验证的新增备注 |
| `zentao/bug-resolve` | `id`、`resolution` | `build`、`to`、`comment`、`image_url`、`image_uid` | 已验证的解决结果，或无需重复写入的结果 |

```sh
chrome-use site zentao/bugs --product 35 --assigned self --status active --limit 100
chrome-use site zentao/bugs --product 35 --status all --limit 1000
chrome-use site zentao/bug 42 --json
chrome-use site zentao/bug-image 42 --image ./config.png --json
```

上传后把返回的图片地址和 UID 一起传给备注或 Resolve 命令。上传本身不会发布备注，
也不会修改工单状态。以下写操作均以当前登录用户身份执行。

```sh
chrome-use site zentao/bug-comment 42 --comment '配置截图见下方。' \
  --image_url https://zentao.pwtk.cc/zentao/file-read-99.png --image_uid UPLOAD_UID
chrome-use site zentao/bug-resolve 42 bydesign --to qa --comment '无需解决，配置的两个区间共用端点。'
```

`comment` 支持 `@file`。本地图片支持 PNG、JPEG、GIF、WebP，最大 10 MB。
`bug-image` 需要 chrome-use 的文件参数支持 `elementRelayUpload`，旧版会返回
`unsupported_upload`。其他禅道部署需要修改域名，并核对接口后使用。

## 查询与详情

`bugs` 不带 `product` 时默认查原生“指派给我”列表；带 `product` 时默认查该产品所有负责人。
`assigned` 接受 `self`、`all` 或精确的账号，显示名独立返回，不用于筛选。
`status` 接受 `all`、`active`、`resolved`、`closed`，默认 `all`。
`limit` 默认 50，范围为 1～10000 的整数。

该部署的产品接口默认只返回未关闭工单，单独按某些状态查询还会错误地返回空列表。
适配器显式请求 `status=all`，再按状态和负责人筛选。`total` 是源列表总数，
`matchedTotal` 只有完整扫描后才有值。`complete` 表示是否扫完，`truncated` 表示可能省略了
匹配记录。重复页、总数变化或分页请求失败会明确报错，不返回看似完整的清单。

`bug` 合并正文及全部备注的截图，每条 action 也保留各自的图片，仅返回本站的
`file-read` 图片地址。下载使用 `chrome-use download-url URL ./image.png`。

## 写后核对

备注根据新增 action ID、实际文本和图片地址确认成功。Resolve 还核对状态、解决方案、
指定负责人和解决版本，默认版本为 `trunk`。支持的解决方案包括 `fixed`、`bydesign`、
`postponed`、`notrepro`、`willnotfix`、`tostory`、`external`，最终以服务端规则为准。
“重复 Bug”需要额外提供目标编号，本命令暂不支持。

工单已解决且与请求完全一致时返回 `unchanged`，不重复写入。工单已解决或关闭，但请求
与现状不一致时返回 `state_conflict`。需要补充说明时使用 `bug-comment`。

写后无法确认会返回 `action_outcome_unknown`、`retryable: false`。
先读取工单核实，再决定是否重试，不能自动重复提交。读取或写入前发现未登录时，
返回 `loginRequired`，交给 chrome-use 的登录流程处理。

## 测试与线上验证范围

运行 `node --test zentao/*.test.cjs`。测试使用合成响应，不会给真实工单留言。
已在线上只读验证产品筛选、负责人账号筛选、已关闭记录，以及已有备注中的截图读取。
新增截图上传和严格写后校验分支只做了离线测试，没有为测试新增上传、备注或解决操作。
截图适配器会在 `finally` 中移除临时文件输入框，不留下命名全局变量或修改页面 API。
