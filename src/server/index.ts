import { createHttpApp } from "./http.js";
import { PromptLibrary } from "./prompt-library.js";
import { PORT } from "./settings.js";

const library = new PromptLibrary();

try {
  const state = await library.open();
  const app = createHttpApp(library);
  const server = app.listen(PORT, "127.0.0.1", () => {
    console.log(`PromptDock 本地服务已启动：http://127.0.0.1:${PORT}`);
    console.log(
      `已加载工作空间：${state.workspaces.length}；规则路径索引：${state.targets.length}`,
    );
    console.log(`诊断日志：${state.diagnosticsPath}`);
  });

  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`PromptDock 启动失败：${message}`);
  process.exitCode = 1;
}
