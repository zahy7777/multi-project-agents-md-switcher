import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const testRootValue = process.env.PROMPTDOCK_E2E_ROOT;
if (!testRootValue) throw new Error("PROMPTDOCK_E2E_ROOT is not configured.");
const testRoot: string = testRootValue;

async function makeWorkspace(name: string, initialRules?: string) {
  const workspace = path.join(testRoot, name);
  await mkdir(workspace, { recursive: true });
  if (initialRules !== undefined) {
    await writeFile(path.join(workspace, "AGENTS.md"), initialRules, "utf8");
  }
  return workspace;
}

async function addWorkspace(
  page: import("@playwright/test").Page,
  workspace: string,
) {
  await page.getByRole("button", { name: "添加工作空间" }).first().click();
  await page.getByPlaceholder(/例如 C:/).fill(workspace);
  await page.getByRole("button", { name: "添加并扫描" }).click();
  await expect(page.getByRole("heading", { name: "添加工作空间" })).toHaveCount(
    0,
  );
  const workspaceButton = page.getByRole("button", {
    name: path.basename(workspace),
    exact: true,
  });
  await expect(workspaceButton).toBeVisible();
  await workspaceButton.click();
  await expect(
    page.getByRole("button", { name: "重新扫描当前工作空间" }),
  ).toBeEnabled();
}

test("候选编辑、预览、切换与冲突合并贯穿真实界面和本地文件", async ({
  page,
}) => {
  const originalRules =
    "# Shared\n\n| Topic | Detail |\n| --- | --- |\n| Prompt | Local |\n\ncommon line\nformal only\n";
  const candidateRules =
    "# Shared\n\n| Topic | Detail |\n| --- | --- |\n| Prompt | Local |\n\ncommon line\ncandidate only\n- [x] review locally\n![test marker](http://127.0.0.1:9999/private.png)\n";
  const externalRules =
    "# Shared\n\n| Topic | Detail |\n| --- | --- |\n| Prompt | Local |\n\ncommon line\nexternal only\n";
  const mergedRules =
    "# Merged\n\ncommon line\nexternal only\ncandidate only\n";
  const workspace = await makeWorkspace("project-rules", originalRules);
  const unexpectedImageRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("private.png")) {
      unexpectedImageRequests.push(request.url());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: /用户级规则/ })).toBeVisible();
  await addWorkspace(page, workspace);
  await expect(page.getByLabel("候选内容")).toHaveValue(originalRules);

  await page.getByRole("button", { name: "新建候选" }).click();
  await page.getByPlaceholder("例如：更严格的代码审查").fill("Candidate B");
  await expect(page.getByRole("button", { name: "创建候选" })).toBeEnabled();
  await page.getByRole("button", { name: "创建候选" }).click();
  await expect(page.getByRole("heading", { name: "创建候选" })).toHaveCount(0);
  await expect(page.getByLabel("候选名称")).toHaveValue("Candidate B");
  await expect(page.getByLabel("候选内容")).toHaveValue(originalRules);
  await page.getByLabel("候选内容").fill(candidateRules);
  await expect(page.getByRole("button", { name: "保存候选" })).toBeEnabled();
  await page.getByRole("button", { name: "保存候选" }).click();
  await expect(page.getByText("候选已保存并记入历史")).toBeVisible();

  const importedSource = path.join(testRoot, "legacy prompt.md");
  const importedRules = "# Imported legacy prompt\n\nDo not modify source.\n";
  await writeFile(importedSource, importedRules, "utf8");
  await page.getByRole("button", { name: "从 Markdown 导入候选" }).click();
  await page.getByLabel("选择候选 Markdown 文件").setInputFiles(importedSource);
  await expect(page.getByLabel("候选名称")).toHaveValue("legacy prompt");
  await expect(page.getByLabel("候选内容")).toHaveValue(importedRules);
  expect(await readFile(importedSource, "utf8")).toBe(importedRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    originalRules,
  );
  await page.getByRole("button", { name: "Candidate B 候选" }).click();

  const exportedDraft = `${candidateRules}export-only draft\n`;
  await page.getByLabel("候选名称").fill("Candidate/B*");
  await page.getByLabel("候选内容").fill(exportedDraft);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Markdown" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Candidate_B_.md");
  const exportedFile = path.join(testRoot, "exported candidate.md");
  await download.saveAs(exportedFile);
  expect(await readFile(exportedFile, "utf8")).toBe(exportedDraft);
  await expect(page.getByText(/有未保存更改/)).toBeVisible();
  const exportStateResponse = await page.request.get("/api/state");
  const exportState = await exportStateResponse.json();
  const exportTarget = exportState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  const savedCandidate = exportTarget.candidates.find(
    (item: { name: string }) => item.name === "Candidate B",
  );
  expect(savedCandidate.content).toBe(candidateRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    originalRules,
  );
  await page.getByLabel("候选名称").fill("Candidate B");
  await page.getByLabel("候选内容").fill(candidateRules);
  await expect(page.getByText(/所有更改已保存/)).toBeVisible();

  await page.getByRole("button", { name: "预览" }).click();
  await expect(page.locator(".markdown-preview h1")).toHaveText("Shared");
  await expect(page.locator(".markdown-preview table")).toHaveCount(1);
  await expect(
    page.locator(".markdown-preview input[type=checkbox]"),
  ).toHaveCount(1);
  await expect(page.locator(".markdown-preview img")).toHaveCount(0);
  await expect(page.locator(".markdown-image-placeholder")).toContainText(
    "test marker",
  );
  expect(unexpectedImageRequests).toEqual([]);
  await page.getByRole("button", { name: "编辑" }).click();

  await page.getByRole("button", { name: "与其他版本对比" }).click();
  await expect(page.locator(".compare-column header strong").nth(1)).toHaveText(
    "导入的正式规则",
  );
  await expect(page.locator(".compare-column pre").nth(0)).toHaveText(
    candidateRules,
  );
  await expect(page.locator(".compare-column pre").nth(1)).toHaveText(
    originalRules,
  );
  await page.getByRole("button", { name: "返回候选" }).click();

  await page.getByRole("button", { name: "切换为正式规则" }).click();
  await expect(page.getByText("与锁定候选一致", { exact: true })).toBeVisible();
  await writeFile(path.join(workspace, "AGENTS.md"), externalRules, "utf8");
  await page.getByRole("button", { name: "重新扫描当前工作空间" }).click();
  await expect(
    page.getByRole("heading", { name: "规则文件冲突" }),
  ).toBeVisible();
  await expect(page.getByText("external only", { exact: true })).toBeVisible();
  await expect(page.getByText("candidate only", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "并排原文" }).click();
  await expect(page.locator(".compare-panel")).toHaveCount(2);
  await page.getByRole("button", { name: "标记差异" }).click();
  await page.getByRole("button", { name: "把正式文件放入解决稿" }).click();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(externalRules);
  await page.getByRole("button", { name: "把锁定候选放入解决稿" }).click();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(candidateRules);
  await page.getByLabel("冲突候选名称").fill("Merged rules");
  await page.getByLabel("冲突解决内容").fill(mergedRules);
  await page.getByRole("button", { name: "保存解决结果" }).click();
  await expect(page.getByText("与锁定候选一致", { exact: true })).toBeVisible();

  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    mergedRules,
  );
  const stateResponse = await page.request.get("/api/state");
  const state = await stateResponse.json();
  const target = state.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(target.conflict).toBe(false);
  expect(
    target.candidates.find((item: { locked: boolean }) => item.locked).content,
  ).toBe(mergedRules);

  await page.getByRole("button", { name: "查看候选历史" }).click();
  await expect(page.locator(".history-revision").first()).toBeVisible();
  await page.getByRole("button", { name: "关闭历史版本" }).click();
  const candidateSearch = page.getByLabel("筛选候选");
  await candidateSearch.fill("Merged");
  await expect(page.locator(".candidate-row")).toHaveCount(1);
  await candidateSearch.fill("review locally");
  await expect(page.locator(".candidate-row")).toHaveCount(1);
  await candidateSearch.fill("does not exist");
  await expect(page.locator(".candidate-row")).toHaveCount(0);
});

test("空目录初始化后，移除工作空间保留文件并可重新添加", async ({ page }) => {
  const workspace = await makeWorkspace("empty-project");
  await page.goto("/");
  await addWorkspace(page, workspace);
  await expect(page.getByText("没有发现 AGENTS.md")).toBeVisible();
  await page.getByRole("button", { name: "初始化 AGENTS.md" }).click();
  await expect(page.getByLabel("候选内容")).toHaveValue("# AGENTS.md\n");
  const formalFile = path.join(workspace, "AGENTS.md");
  expect(await readFile(formalFile, "utf8")).toBe("# AGENTS.md\n");

  await expect(
    page.getByRole("button", { name: "从列表移除工作空间 codex" }),
  ).toHaveCount(0);
  const beforeResponse = await page.request.get("/api/state");
  const beforeState = await beforeResponse.json();
  const beforeTarget = beforeState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  const candidateId = beforeTarget.candidates[0].id;

  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "从列表移除工作空间 empty-project" })
    .click();
  await expect(
    page.getByRole("button", { name: "empty-project", exact: true }),
  ).toHaveCount(0);
  expect(await readFile(formalFile, "utf8")).toBe("# AGENTS.md\n");

  await addWorkspace(page, workspace);
  await expect(page.getByLabel("候选内容")).toHaveValue("# AGENTS.md\n");
  const afterResponse = await page.request.get("/api/state");
  const afterState = await afterResponse.json();
  const afterTarget = afterState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(
    afterTarget.candidates.map((item: { id: string }) => item.id),
  ).toContain(candidateId);
});

test("帮助诊断链接可打开本机日志，错误添加可重试", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "使用说明与诊断" }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: "在浏览器中打开诊断日志" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/api\/diagnostics$/);
  await expect(popup.locator("body")).toContainText('"event"');
  await popup.close();
  await page.getByRole("button", { name: "知道了" }).click();

  await page.getByRole("button", { name: "添加工作空间" }).first().click();
  await page
    .getByPlaceholder(/例如 C:/)
    .fill(path.join(testRoot, "missing-workspace"));
  await page.getByRole("button", { name: "添加并扫描" }).click();
  await expect(page.locator(".toast-error")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "添加工作空间" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
});
