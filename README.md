# PromptDock Web

PromptDock 是本机运行的 `AGENTS.md` 规则管理器。浏览器呈现工作台，Node 服务负责扫描和写入工作空间，并在本地 Git 中记录候选历史。规则正文不会上传。

## 运行

要求 Node.js 20+、pnpm 和可从终端调用的 Git（候选历史使用本地 Git）。在项目目录执行：

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

## 使用规则

1. 用户级 Codex 规则作为普通路径自动添加并排在工作空间列表顶部；默认位置是 `CODEX_HOME/AGENTS.md`，未设置 `CODEX_HOME` 时是 `~/.codex/AGENTS.md`。
2. 添加工作空间时粘贴本机绝对目录路径。服务递归扫描其中的 `AGENTS.md`；之后可手动重扫，每次打开或重新加载工作台也会重扫所有已登记路径。扫描不跟随符号链接。
3. 已存在的规则会被导入为候选并立即锁定。没有规则的目录不会自动创建候选；使用“初始化 AGENTS.md”明确创建正式文件和首个锁定候选。
4. 新建候选会复制编辑器当前内容。候选可单独编辑和保存；每次保存都记入本地 Git。锁定候选保存时同时更新工作空间中的正式文件。
5. 正式文件与锁定候选不一致时显示冲突，并阻止切换。将正式内容或锁定候选内容放入解决稿后，可以手动合并；保存解决稿会创建新候选，同时同步正式文件并锁定它。

## 本地数据与诊断

- 候选、工作空间登记、锁定状态和 Git 历史在本机应用数据目录的 `PromptDock/Web/library` 下。
- 诊断日志在同级 `logs/promptdock.jsonl`，只记录操作事件、路径、耗时和错误摘要，不记录规则正文。
- 默认数据目录是 Windows `%LOCALAPPDATA%/PromptDock/Web`、macOS `~/Library/Application Support/PromptDock/Web`、Linux `$XDG_DATA_HOME/promptdock/web`（未设置时 `~/.local/share/promptdock/web`）。
- 可设置 `PROMPTDOCK_DATA_DIR` 将应用数据放到指定目录，便于隔离测试或备份。

纯浏览器无法获得系统目录选择器返回的任意本机路径，因此添加工作空间使用路径输入框；实际文件操作仍由本机 Node API 完成。
