import { execFile, spawn } from "node:child_process";
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
  const picker = spawn(
    "powershell.exe",
    ["-NoProfile", "-STA", "-Command", script],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  picker.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  picker.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const closed = new Promise<number>((resolve, reject) => {
    picker.once("error", reject);
    picker.once("close", (code) => resolve(code ?? 1));
  });
  if (!picker.pid) throw new Error("无法启动 Windows 文件夹选择器。");
  try {
    await bringPickerToFront(picker.pid);
  } catch (error) {
    picker.kill();
    throw error;
  }
  const exitCode = await closed;
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || "Windows 文件夹选择器启动失败。");
  }
  const encodedPath = stdout.trim();
  return encodedPath
    ? Buffer.from(encodedPath, "base64").toString("utf8")
    : null;
}

async function bringPickerToFront(processId: number) {
  const script = [
    "$shell = New-Object -ComObject WScript.Shell",
    "for ($attempt = 0; $attempt -lt 15; $attempt++) {",
    `  if ($shell.AppActivate(${processId})) { exit 0 }`,
    "  Start-Sleep -Milliseconds 200",
    "}",
    "exit 1",
  ].join("; ");
  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script],
      { windowsHide: true },
    );
  } catch {
    throw new Error(
      "文件夹选择器已启动，但无法切换到前台。请重试或手动输入路径。",
    );
  }
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
