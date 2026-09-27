import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";

/** Owns the per-workspace ignore rules and their gitignore matching behavior. */
export class WorkspaceIgnore {
  private readonly rulesDirectory: string;
  private readonly matchers = new Map<string, ReturnType<typeof ignore>>();

  constructor(dataDirectory: string) {
    this.rulesDirectory = path.join(dataDirectory, "workspace-ignore");
  }

  async read(workspace: string) {
    try {
      return await fs.readFile(this.fileFor(workspace), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  }

  async write(workspace: string, rules: string) {
    await fs.mkdir(this.rulesDirectory, { recursive: true });
    const destination = this.fileFor(workspace);
    const temporary = `${destination}.${process.pid}.tmp`;
    await fs.writeFile(temporary, rules, "utf8");
    await fs.rename(temporary, destination);
  }

  matcher(rules: string) {
    let matcher = this.matchers.get(rules);
    if (!matcher) {
      matcher = ignore().add(rules);
      this.matchers.set(rules, matcher);
    }
    return matcher;
  }

  private fileFor(workspace: string) {
    const key = createHash("sha256").update(workspace).digest("hex");
    return path.join(this.rulesDirectory, `${key}.gitignore`);
  }
}
