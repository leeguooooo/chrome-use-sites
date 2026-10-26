# 视频号封面选择

[English](README.md) · 中文

`cover-select` 与已有 OpenCLI `wechat-channels/publish` 配合使用，只操作没有
查询参数的新 `/platform/post/create` 表单，不发表、不保存草稿，也不修改已有作品。

```sh
chrome-use site wechat-channels/publish ./clip.mp4 --manual true
chrome-use site wechat-channels/cover-select --cover ./portrait.png --cover-mode upload
```

上传需要文件对象提供 `elementRelayUpload: true` 能力的 chrome-use 构建，即包含
relay 元素上传修复的版本。旧构建会在打开编辑器前明确拒绝；已发布的 1.5.265
没有这个能力。`cover` 接受 JPG／PNG。适配器在 wujie shadow root 里定位实际
图片输入框，用 `args.ui` 真实输入操作控件，等编辑器关闭、3:4 预览加载并更换后
才报告成功。支持实测的内联裁剪，也处理可选的嵌套裁剪弹窗。

`--cover-mode keep` 只读取已选好的预览；`--cover-mode confirm` 明确确认当前可见
裁剪，不重复上传。操作中断后先检查画面，再决定是否确认；无法核验时返回
`cover_confirmation_required`，不会报告成功让调用方盲目重试。
不支持 AI 生成、任意指定帧或修改已发布作品封面，不会调用付费生成。

验证包括脱敏后的真实编辑器样本、离线正常与故障分支，以及自有测试表单的一次
完整上传／裁剪／预览流程，实页确认了 720×960 预览。测试视频已从表单移除，
自有测试标签页已关闭，没有保存草稿或发表。这不代表所有账号版本和已发布作品
修改均已通过验收。

[QA 验收记录](fixtures/qa-acceptance.json)包含仅截取测试封面的图片，以及另一次完整适配器调用的结果。

## 从本地视频指定帧

兼容的 CLI 安装 FFmpeg 后，原生适配器支持
`--cover-mode frame:1.5 --cover-video ./clip.mp4 --cover-output ./cover-1.5.png`。
时间为本地视频中的明确秒数。CLI 截取一张 PNG，保留作核对用的文件，再走现有图片
上传和预览核验流程。抖音会将同一帧交给两个比例分别裁剪；需要不同横、竖图时仍用
upload 模式分别传图片。

输出必须是尚不存在的 `.png`，不会覆盖已有文件。没有对应帧、FFmpeg 不可用等情况
会在浏览器操作前失败。近黑、近纯色画面会停下要求核对；看过图片后，只有明确传
`--allow-dark-cover true` 并使用新输出路径，才会接受该提示。这只是像素启发式检查，
不是封面质量评价。本地截帧不触发平台 AI，也不操作平台时间轴。旧 CLI 没有这项预处理，
需先升级。
