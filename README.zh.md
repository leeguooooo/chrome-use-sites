# chrome-use-sites

[English](README.md) · 中文

**[chrome-use](https://github.com/leeguooooo/chrome-use) 官方的 site adapter 仓库。** 这里放 chrome-use 项目自己维护的 adapter，包括内网或自建服务的，这类不适合放进公共的社区仓库 [`epiral/bb-sites`](https://github.com/epiral/bb-sites)。

*site adapter* 是一个带 `/* @meta {…} */` 头的 JS 函数。`chrome-use site <name>/<cmd>` 会在**你自己已登录的标签页**里打开 adapter 对应的域名并运行这个函数，返回结构化 JSON：不抓页面、不截图；因为是以你的身份运行，登录墙和 VPN 后面的服务也能用。

chrome-use 内置两个 adapter 来源：

- 社区：[`epiral/bb-sites`](https://github.com/epiral/bb-sites)
- 官方：[`leeguooooo/chrome-use-sites`](https://github.com/leeguooooo/chrome-use-sites)

两者都会在第一次使用时、以及 `chrome-use site update` 时自动同步。官方仓库最后同步，同名命令以官方为准。包含 [chrome-use#133](https://github.com/leeguooooo/chrome-use/pull/133) 的版本不需要 `site add`，也不需要单独的安装脚本。

chrome-use 也能运行 [OpenCLI](https://github.com/jackwener/opencli)（`@jackwener/opencli`）的部分命令，但只限两个仓库都没有的命令名：这里的 adapter 永远优先于 OpenCLI 的同名命令。我们依赖的命令已移植到这里维护，不再从 OpenCLI 运行：`douyin/delete`、`douyin/update`、`twitter/delete`，按 OpenCLI 的 Apache-2.0 许可证注明出处（见各 pack 的 README）。

## 安装与更新

```sh
chrome-use site update
chrome-use site sources
chrome-use site list | grep '^sggit/'
```

chrome-use v1.5.77 及更早的版本用旧安装脚本：

```sh
curl -fsSL https://raw.githubusercontent.com/leeguooooo/chrome-use-sites/main/install.sh | sh
```

adapter 在你已登录的标签页里运行，所以**先登录目标网站**（内网服务还要先连 VPN/WARP）。

## Packs

每个 pack 在自己的目录里有说明文档，英文 `README.md`、中文 `README.zh.md`。

| pack | 网站 | adapter | |
| --- | --- | --- | --- |
| [`twitter/`](twitter/) | x.com | `search`、`thread`、`user`、`post`、`delete` | 读取 + 发帖 + 删帖 |
| [`xiaohongshu/`](xiaohongshu/) | www.xiaohongshu.com | `me` | 读取 |
| [`xiaohongshu-creator/`](xiaohongshu-creator/) | creator.xiaohongshu.com | `me`、`notes`、`note-stats` | 读取 |
| [`douyin-creator/`](douyin-creator/) | creator.douyin.com | `me`、`works`、`video-publish` | 读取 + 发布 |
| [`douyin/`](douyin/) | creator.douyin.com | `delete`、`update` | 删除 + 修改作品 |
| [`bilibili-creator/`](bilibili-creator/) | member.bilibili.com | `video-publish` | 发布 |
| [`youtube-studio/`](youtube-studio/) | studio.youtube.com | `channel`、`video-upload` | 读取 + 发布 |
| [`juejin/`](juejin/) · [`csdn/`](csdn/) · [`segmentfault/`](segmentfault/) · [`zhihu/`](zhihu/) | 国内技术社区 | `article-publish` | 发布 |
| [`chatgpt/`](chatgpt/) | chatgpt.com | `me`、`conversations`、`conversation`、`projects`、`models`、`images`、`open-project` | 读取（+ 打开项目） |
| [`appstoreconnect/`](appstoreconnect/) | appstoreconnect.apple.com | `apps`、`app-create`、`builds` | 读取 + 创建 |
| [`si12333/`](si12333/) | si.12333.gov.cn | `pension-payments` | 读取 |
| [`sggit/`](sggit/) | sg-git.pwtk.cc（自建 Gogs） | `pr-create`、`pr-list`、`pr-merge` | 读取 + 写入 |

改动记录在 [CHANGELOG.md](CHANGELOG.md)。每个 PR 都必须遵守的贡献规范：[CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)。

## 添加 adapter

先看 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)：每次改动都要同时更新该 pack 的 `README.md` 和 `README.zh.md`，并在 `CHANGELOG.md` 里加一条记录，否则 CI 不通过。

把 `packname/command.js` 放进仓库，照现有文件的格式写。当前版本的 chrome-use 会直接从仓库目录里发现 `.js` adapter。旧安装脚本（v1.5.77）还在支持期内，所以也要把路径加进 `install.sh` 的 `PACKS`。

```js
/* @meta
{ "name": "packname/command", "domain": "host.example.com",
  "args": { "foo": {"required": true, "description": "…"} },
  "capabilities": ["network"], "readOnly": true }
*/
async function (args) {
  // 在 `domain` 对应的已登录标签页里运行；同源 fetch 自动带 cookie。
  return { /* 结构化 JSON */ };
}
```

参数名不要和 chrome-use 的全局参数撞名（`state`、`profile`、`session`、`timeout`、`url`、`fn` 等）。

## 许可证

MIT，见 [LICENSE](LICENSE)。贡献内容同样按此许可证接受。例外：从 OpenCLI 移植的文件（`douyin/delete.js`、`douyin/update.js`、`twitter/delete.js`）仍按 Apache License 2.0 授权，许可证全文放在旁边（`LICENSE-OpenCLI`），每个文件开头写明了修改内容。
