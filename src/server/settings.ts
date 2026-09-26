import os from "node:os";
import path from "node:path";

export const PORT = Number(process.env.PORT ?? 4317);

export function applicationDataDirectory() {
  if (process.env.PROMPTDOCK_DATA_DIR) {
    return path.resolve(process.env.PROMPTDOCK_DATA_DIR);
  }

  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      "PromptDock",
      "Web",
    );
  }

  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "PromptDock",
      "Web",
    );
  }

  return path.join(
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
    "promptdock",
    "web",
  );
}

export function userRulesFile() {
  const codexHome = process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), ".codex");
  return path.join(codexHome, "AGENTS.md");
}
