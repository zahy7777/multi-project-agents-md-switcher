import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function chooseLocalDirectory(): Promise<string | null> {
  if (process.platform === "win32") return chooseOnWindows();
  if (process.platform === "darwin") return chooseOnMacOS();
  if (process.platform === "linux") return chooseOnLinux();
  throw new Error("当前系统暂不支持系统文件夹选择器。");
}

async function chooseOnWindows() {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = '选择要添加的工作空间文件夹'",
    "$dialog.ShowNewFolderButton = $false",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath))",
    "}",
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-STA",
    "-Command",
    script,
  ]);
  const encodedPath = stdout.trim();
  return encodedPath
    ? Buffer.from(encodedPath, "base64").toString("utf8")
    : null;
}

async function chooseOnMacOS() {
  const { stdout } = await execFileAsync("osascript", [
    "-e",
    'POSIX path of (choose folder with prompt "选择要添加的工作空间文件夹")',
  ]);
  return stdout.trim().replace(/\/$/, "") || "/";
}

async function chooseOnLinux() {
  for (const command of ["zenity", "kdialog"]) {
    try {
      const args =
        command === "zenity"
          ? [
              "--file-selection",
              "--directory",
              "--title=选择要添加的工作空间文件夹",
            ]
          : [
              "--getexistingdirectory",
              process.env.HOME ?? ".",
              "选择要添加的工作空间文件夹",
            ];
      const { stdout } = await execFileAsync(command, args);
      return stdout.trim() || null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      if ((error as { code?: number }).code === 1) return null;
      throw error;
    }
  }
  throw new Error("未找到系统文件夹选择器，请安装 zenity 或 kdialog。");
}
