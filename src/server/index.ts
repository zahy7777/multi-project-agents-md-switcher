import { spawn } from "node:child_process";
import { createHttpApp } from "./http.js";
import { PromptLibrary } from "./prompt-library.js";
import { PORT } from "./settings.js";

const library = new PromptLibrary();

try {
  const state = await library.open();
  const app = createHttpApp(library);
  const server = app.listen(PORT, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${PORT}`;
    console.log(`AGENTS.md Switcher 本地服务已启动：${url}`);
    console.log(
      `已加载工作空间：${state.workspaces.length}；规则路径索引：${state.targets.length}`,
    );
    console.log(`诊断日志：${state.diagnosticsPath}`);
    if (process.env.PROMPTDOCK_OPEN_BROWSER === "1") openBrowser(url);
  });

  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`AGENTS.md Switcher 启动失败：${message}`);
  process.exitCode = 1;
}

function openBrowser(url: string) {
  const command =
    process.platform === "win32"
      ? "rundll32.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const browser = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  browser.once("error", (error) => {
    console.error(`打开默认浏览器失败：${error.message}`);
  });
  browser.unref();
}
