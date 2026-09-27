# PromptDock — AGENTS.md 磁盘文件与缓存方案管理器

**在本机管理 AI agent 指令文件的多个缓存方案、切换当前方案，并查看每个方案自己的历史版本。** PromptDock 是一个本地优先的桌面浏览器应用，适用于 Codex 等读取 `AGENTS.md` 的开发工具。文件内容、缓存方案与历史版本都留在你的设备上。

> **核心模型：磁盘文件 + 缓存方案。** 一个目录路径对应唯一的 `AGENTS.md` 磁盘文件；一个磁盘文件可以有多个独立的缓存方案。每个方案都有自己的历史版本。当前方案应与磁盘文件保持一致；切换方案时，PromptDock 会先预览差异，确认后再将方案写入磁盘文件。外部程序改动磁盘文件时，PromptDock 会提示冲突并要求先合并。

## 快速开始

需要 Node.js 20+、pnpm 和 Git。克隆项目后运行：

```sh
pnpm install
pnpm dev
```

打开 <http://127.0.0.1:5173>，添加包含 `AGENTS.md` 的本机目录。首次使用生产单进程模式：

```sh
pnpm build
pnpm start
```

再打开 <http://127.0.0.1:4317>。GitHub 上的[完整中文指南](#中文使用指南)包含 Windows 启动方式、操作说明和本地数据位置。

## 用一个例子理解磁盘和缓存

假设项目磁盘上已有 `my-app/AGENTS.md`，其中要求 agent 使用 TypeScript。你可以从它 Fork 出“严格类型检查”和“快速原型”两个**缓存方案**，分别编辑和保存；每次保存都会给相应方案增加一个**历史版本**。之后选择“严格类型检查”，预览它与磁盘文件的差异并确认，磁盘上的 `AGENTS.md` 就会被同步。方案切换不删除其他方案；你可以随时查看或 Fork 某个方案的历史版本。

| 名称 | 表示什么 | 例子 |
| --- | --- | --- |
| 磁盘文件 | 目标路径上真实存在、agent 实际读取的唯一文件 | `my-app/AGENTS.md` |
| 缓存方案 | 同一磁盘文件的独立内容选项，可编辑、归档和切换 | “严格类型检查”“快速原型” |
| 历史版本 | 某个缓存方案保存时留下的只读快照 | “严格类型检查”的上一次保存 |
| 当前方案 | 当前与磁盘文件同步的方案 | 切换后写入 `AGENTS.md` 的方案 |

![PromptDock 的文件和缓存方案管理界面](docs/screenshots/zh-main.png)

### 历史版本与差异

每个缓存方案都有独立历史，可查看保存时间、方案名称和正文差异，也可以 Fork 历史版本作为新方案。查看历史只读，不会回滚磁盘文件。

![PromptDock 的方案历史版本界面](docs/screenshots/zh-history.png)

### 外部修改与冲突处理

如果 agent 或其他编辑器改动了磁盘文件，导致它与当前方案不一致，PromptDock 会阻止直接切换。你可以对照磁盘文件和当前方案，形成新的解决稿，再一次性保存并恢复同步。

![PromptDock 的磁盘文件冲突处理界面](docs/screenshots/zh-conflict.png)

## 中文使用指南

PromptDock 在本机运行：浏览器呈现界面，Node 服务负责扫描和写入工作空间，本地 Git 记录方案历史。它不会将文件正文上传到云端。

## 运行

要求 Node.js 20+、pnpm 和可从终端调用的 Git（历史版本使用本地 Git 保存）。在项目目录执行：

```powershell
pnpm install
pnpm dev
```

开发页面位于 `http://127.0.0.1:5173`，本地 API 位于 `http://127.0.0.1:4317`。日常单进程模式：

```powershell
pnpm build
pnpm start
```

然后打开 `http://127.0.0.1:4317`。服务只监听本机回环地址；停止终端中的进程即可结束服务，不安装后台守护进程。

Windows 可双击项目目录中的 `启动 PromptDock.cmd`：脚本先构建，再启动服务并打开默认浏览器。关闭启动窗口会结束服务。

## 真实浏览器验收

首次运行安装 Playwright Chromium：

```powershell
pnpm exec playwright install chromium
```

随后执行 `pnpm test:e2e`。验收会构建生产前端、启动本地 Node 服务并操作真实浏览器；用户文件、工作空间和应用数据都放在系统临时目录，结束后自动清理。

## 使用说明

1. Codex 用户文件作为普通路径自动添加并排在工作空间列表顶部；默认位置是 `CODEX_HOME/AGENTS.md`，未设置 `CODEX_HOME` 时是 `~/.codex/AGENTS.md`。
2. 添加工作空间时可用系统文件夹选择器，也可输入本机绝对目录路径。服务递归扫描其中的 `AGENTS.md`；之后可手动重扫，每次打开或重新加载文件管理也会重扫所有已登记路径。打开时先显示本地保存的工作空间与文件，再在后台重扫并更新列表；扫描期间顶部状态提示显示进度状态。扫描不跟随符号链接。同名工作空间会附带父路径缩写，避免把不同目录误认成同一路径。有未保存草稿时，手动重扫会先询问，因为扫描可能发现冲突并切换到解决页；取消不会发起扫描，确认后若发生冲突，可将草稿放入解决稿继续合并。已编辑的冲突解决稿也会在重扫前提示；确认重扫后解决稿保留，冲突两侧刷新，如需使用新磁盘文件内容可明确载入解决稿。切换工作空间或文件路径、添加并切换工作空间、移除当前工作空间时，未保存的方案（名称或正文）或冲突解决稿（方案名称或正文）也会先询问；取消保留当前编辑位置和草稿，确认后离开即丢弃。
   工作空间行末的移除按钮只取消路径登记，不删除磁盘文件、缓存方案或历史版本；之后重新添加相同路径即可继续管理。自动登记的用户文件路径不能移除。
3. 发现磁盘文件时，会将其内容导入为首个缓存方案并设为当前方案。没有磁盘文件的目录不会自动创建缓存方案；使用“初始化 AGENTS.md”明确创建磁盘文件和首个缓存方案，并设为当前方案。
4. 新建缓存方案可复制编辑器当前内容（包括未保存修改），也可从此路径的任一已保存方案 Fork 一份；弹窗可展开只读预览来源正文。若当前编辑器有未保存修改，从已保存方案 Fork 会保留原编辑器和草稿，新方案加入列表但不抢占编辑位置。也可以从本机 `.md`／`.markdown` 文件 Fork 一个缓存方案（未设为当前方案）。Fork 不会修改来源文件或磁盘文件。缓存方案可单独编辑和保存；每次保存都会为该方案生成一个历史版本并记入本地 Git。保存时服务端会核对页面打开时的方案名称和正文；如果另一个窗口已经保存了新内容，过期保存会被拒绝，当前草稿保留，可用“新建缓存方案”另存。保存当前方案时同时更新工作空间中的磁盘文件；当前方案有未保存修改时，编辑器会显示本次同步对磁盘文件新增和删除的行数。
   切换当前方案前会先检查最新磁盘文件状态，再显示所选缓存方案与磁盘文件的逐行差异及增删行数；发现外部修改会先进入冲突处理。只有确认后才写入磁盘文件，服务端也会在确认时再次检查。取消预览不改动文件或当前方案。
5. 磁盘文件与当前方案不一致时显示冲突，并阻止切换。冲突页默认标出从当前方案到磁盘文件的逐行新增和删除，也可并排查看原文。可将磁盘文件、当前方案或未保存草稿放入解决稿再手动合并；保存解决稿会创建新缓存方案，同时同步磁盘文件并将新方案设为当前方案。
6. 每次保存方案都会为该方案生成一个历史版本，包括只改方案名称的保存。历史版本可逐行比较正文，也能查看当时的方案名称。历史版本视图只读，不会改写缓存方案或磁盘文件。可直接导出选中的历史版本为 Markdown；也可从历史版本 Fork 一个新缓存方案，不会回滚历史或直接覆盖磁盘文件。
7. 其他缓存方案可与磁盘文件或其他缓存方案比较；对比基准下拉框按“磁盘”“缓存方案”“已归档”分组。左侧使用当前编辑器内容（包括未保存草稿），右侧显示所选基准。当前方案正文有未保存修改时，可直接预览草稿与磁盘文件的差异。支持逐行标记差异或并排原文；该预览只读，编辑当前方案的正文只会在保存时同步磁盘文件。
8. 编辑器可在编辑和 Markdown 预览间切换；预览随当前草稿即时更新，支持 GFM 表格和任务列表，不会保存内容。原始 HTML 不渲染，图片链接显示占位文字而不发起网络请求。方案编辑区和冲突解决稿都会实时显示当前草稿的行数、Unicode 码点数和 UTF-8 字节数；空内容计一行，末尾换行后的空行也计入，帮助发现文件体量变化。
9. 缓存方案列表可按名称或正文搜索；搜索只隐藏暂时不匹配的方案，不会切换或删除方案。列表上方可重命名或删除选中的缓存方案；重命名会记入本机历史，不更改正文，当前方案不可删除。删除会将方案从列表和搜索结果中移除，旧的历史版本仍保留在本机 Git 中。同一路径存在同名方案时，列表会附加各自 ID 前 7 位，方便区分并选择准确方案。
10. “复制内容”会将当前编辑器正文（包括未保存修改）复制到系统剪贴板，方便直接粘贴到其他工具；复制成功后按钮短暂显示“已复制”。冲突页的“复制解决稿”会复制未保存的合并文本。磁盘文件信息卡片中的“复制路径”会复制完整 `AGENTS.md` 绝对路径。“导出 Markdown”会下载当前编辑器内容。这些操作都不会改变缓存方案、历史版本或磁盘文件。
11. 在方案名称或正文编辑框按 `Ctrl+S`（macOS 为 `⌘S`）保存当前方案，并生成历史版本；冲突解决稿仍通过“保存解决结果”明确提交。方案有未保存修改时可“还原已保存内容”，经确认后恢复此方案最近保存的名称和正文，不改磁盘或历史。任一弹窗都可按 `Esc` 关闭，效果等同于关闭按钮，不会保存或提交内容。刷新或关闭页面时，浏览器会对未保存方案或冲突解决稿显示离开确认；取消离开会保留当前草稿。
12. 非当前方案可归档以收起试验方案；归档只改变方案的本地管理状态并记入历史，不删除正文、历史版本或磁盘文件。可在“已归档”列表查看只读方案并恢复；当前方案不能归档，冲突时不能归档或恢复。
13. 顶部“搜索全部文件”或 `Ctrl+Shift+F`（macOS 为 `⌘⇧F`）会搜索当前登记工作空间下所有已扫描路径的磁盘文件和缓存方案正文，包括已归档方案；磁盘文件与当前方案内容相同时只显示一次，发生冲突时两侧分别显示。移除工作空间后，保留的方案和历史版本不再出现在搜索中；重新添加路径后可再次搜索。点击结果可打开对应路径和方案；若当前有未保存草稿，需要确认后才会离开。
14. 编辑方案时可查找当前正文中的原文并逐处或全部替换；匹配区分大小写。替换只改变当前草稿，保存前不会写入缓存方案或磁盘文件；保存当前方案时仍会同步磁盘文件。

## 本地数据与诊断

- 缓存方案、工作空间登记、当前方案状态和历史版本在本机应用数据目录的 `PromptDock/Web/library` 下。
- 诊断日志在同级 `logs/promptdock.jsonl`，只记录操作事件、路径、耗时和错误摘要，不记录文件正文。
- 默认数据目录是 Windows `%LOCALAPPDATA%/PromptDock/Web`、macOS `~/Library/Application Support/PromptDock/Web`、Linux `$XDG_DATA_HOME/promptdock/web`（未设置时 `~/.local/share/promptdock/web`）。
- 可设置 `PROMPTDOCK_DATA_DIR` 将应用数据放到指定目录，便于隔离测试或备份。

纯浏览器无法获得系统目录选择器返回的任意本机路径，因此添加工作空间使用路径输入框；实际文件操作仍由本机 Node API 完成。

## English guide

PromptDock is a local-first **AGENTS.md manager** for people who maintain different instruction sets for AI coding agents. It runs on your computer and keeps file contents and Git history local.

### The disk file and cache plans

Think of the model as one disk file and several cache plans. A directory has one `AGENTS.md` disk file, which is the file an agent reads. Cache plans are independent alternatives for that file. Each plan has its own saved version history.

For example, start with `my-app/AGENTS.md` and Fork two plans: “Strict TypeScript” and “Rapid prototyping.” Edit and save each plan independently. When you switch the current plan, PromptDock previews its diff against the disk file and writes it only after you confirm. Later, open that plan's history to compare or Fork an earlier snapshot. History browsing never rewrites the disk file.

| Term | Meaning |
| --- | --- |
| Disk file | The single `AGENTS.md` at a target directory; the agent reads this file. |
| Cache plan | An independent, editable alternative for the disk file. |
| Version history | Read-only snapshots saved by one cache plan. |
| Current plan | The plan synchronized with the disk file. |

### Screenshots

![PromptDock file and cache plan overview](docs/screenshots/zh-main.png)

![Per-plan version history](docs/screenshots/zh-history.png)

![Disk file conflict review](docs/screenshots/zh-conflict.png)

### Quick start

Requirements: Node.js 20 or later, pnpm, and Git.

```sh
pnpm install
pnpm dev
```

Open <http://127.0.0.1:5173> and add a local directory containing `AGENTS.md`. For the single-process production mode:

```sh
pnpm build
pnpm start
```

Then open <http://127.0.0.1:4317>. The service listens on the local loopback interface. On Windows, you can also launch `启动 PromptDock.cmd` from Explorer.

### Features

- Add local directories and scan for `AGENTS.md` files.
- Create, Fork, rename, archive, search, and switch independent cache plans.
- Save per-plan history in local Git; compare snapshots and Fork an earlier version.
- Preview disk-file and plan diffs before switching.
- Resolve external-edit conflicts with a merge draft before synchronizing again.
- Edit Markdown with live preview, find and replace, and unsaved-draft protection.
- Search disk files and cache plan contents across registered directories.

### Privacy and local data

PromptDock does not upload file contents. The Node service binds to `127.0.0.1` and performs local file operations. Cache plans, workspace registrations, and Git history are stored in the local PromptDock data directory. See [Local data and diagnostics](#本地数据与诊断) for platform-specific paths and the `PROMPTDOCK_DATA_DIR` override.

## License

No license has been selected yet. Until a license is added, standard copyright applies to this source code.
