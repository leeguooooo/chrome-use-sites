# 贡献规范

[English](CONTRIBUTING.md) · 中文

下面是硬性规定。第 1–3 条和第 6 条由 `node --test` 检查，每个 PR 都会自动跑，不通过的 PR 不合并。

1. **每个 pack 中英文文档各一份。** 每个目录都要有 `README.md`（英文）和
   `README.zh.md`（中文），互相链接，并且都写到这个 pack 里的每一个 adapter。
   在 GitHub 上点进目录看到的就是 `README.md`，所以要写全：做什么、命令、参数、
   返回字段、限制。改了 adapter，同一个 PR 里两份都要改。
2. **CHANGELOG。** 在 [CHANGELOG.md](CHANGELOG.md) 加一条带日期的记录
   （`## YYYY-MM-DD`，新的在上），写明新增或改动了哪些 adapter。
3. **安装列表。** 新 adapter 文件要加进 `install.sh` 的 `PACKS`。
4. **测试不依赖真实网站。** 新行为要在 pack 里配一个打桩测试（`node --test <pack>/`）。
   fixtures 用抓到的真实响应、只留 adapter 读的字段；仓库是公开的，提交前去掉隐私内容。
5. **真实账号上的验证要省着用。** 跑真实账号前先看 [AGENTS.md](AGENTS.md)：不许对线上
   ChatGPT 测；小红书、抖音、B站每个 adapter 只跑一次、不循环；没人要求的内容不发、不删、不改。
6. **隐身优先。** adapter 跑在用户真实登录的账号上，网页能看到的痕迹都可能害账号被限流或封禁。
   写操作 adapter 的点击、输入、按键、滚动一律走 `args.ui`（chrome-use 发真实输入事件）；
   自己发的 `el.click()`、`dispatchEvent`、`execCommand` 只能留作旧版 chrome-use 的回退。
   不许在 `window` 上挂具名全局变量，不许改写页面的原型或对象（比如 `XMLHttpRequest.prototype`），
   不许在页面里留下 DOM 节点；固定的等待时间要带随机抖动。`stealth.test.js` 检查前两条，
   合并者审 PR 时检查其余几条。

adapter 的格式和命名见 [README](README.zh.md) 的「添加 adapter」。
