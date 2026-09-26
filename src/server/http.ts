import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import fs from "node:fs/promises";
import path from "node:path";
import type { PromptLibrary } from "./prompt-library.js";
import { PORT } from "./settings.js";

const uiOrigins = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
]);

export function createHttpApp(library: PromptLibrary) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  const localOnly: RequestHandler = (request, response, next) => {
    const host = request.headers.host?.split(":")[0].toLowerCase();
    if (host !== "127.0.0.1" && host !== "localhost") {
      response
        .status(403)
        .json({ error: { code: "LOCAL_ONLY", message: "只允许本机访问。" } });
      return;
    }
    const origin = request.headers.origin;
    if (origin && !uiOrigins.has(origin)) {
      response.status(403).json({
        error: { code: "ORIGIN_REJECTED", message: "请求来源不受允许。" },
      });
      return;
    }
    if (request.method !== "GET" && !origin) {
      response.status(403).json({
        error: {
          code: "ORIGIN_REQUIRED",
          message: "写入请求必须来自本机管理界面。",
        },
      });
      return;
    }
    next();
  };

  app.use("/api", localOnly);
  app.get("/api/health", (_request, response) =>
    response.json({ status: "ready" }),
  );
  app.get("/api/state", async (_request, response) =>
    response.json(await library.getState()),
  );
  app.get("/api/diagnostics", async (_request, response) => {
    response.type("text/plain").send(await library.readDiagnostics());
  });
  app.post("/api/workspaces", async (request, response) => {
    response.json(
      await library.addWorkspace(readString(request.body?.path, "path")),
    );
  });
  app.post("/api/workspaces/scan", async (request, response) => {
    response.json(
      await library.rescanWorkspace(readString(request.body?.path, "path")),
    );
  });
  app.post("/api/workspaces/scan-all", async (_request, response) => {
    response.json(await library.scanAllWorkspaces());
  });
  app.post("/api/paths/initialize", async (request, response) => {
    response.json(
      await library.initializePath(readString(request.body?.path, "path")),
    );
  });
  app.post("/api/candidates", async (request, response) => {
    response.json(
      await library.createCandidate(
        readString(request.body?.path, "path"),
        readString(request.body?.name, "name"),
        readString(request.body?.content, "content", true),
      ),
    );
  });
  app.get("/api/candidates/:candidateId/history", async (request, response) => {
    response.json(
      await library.candidateHistory(
        readString(request.query.path, "path"),
        readString(request.params.candidateId, "candidateId"),
      ),
    );
  });
  app.get(
    "/api/candidates/:candidateId/history/:commit",
    async (request, response) => {
      response.json(
        await library.candidateRevision(
          readString(request.query.path, "path"),
          readString(request.params.candidateId, "candidateId"),
          readString(request.params.commit, "commit"),
        ),
      );
    },
  );
  app.put("/api/candidates", async (request, response) => {
    response.json(
      await library.saveCandidate(
        readString(request.body?.path, "path"),
        readString(request.body?.candidateId, "candidateId"),
        readString(request.body?.name, "name"),
        readString(request.body?.content, "content", true),
      ),
    );
  });
  app.post("/api/candidates/lock", async (request, response) => {
    response.json(
      await library.lockCandidate(
        readString(request.body?.path, "path"),
        readString(request.body?.candidateId, "candidateId"),
      ),
    );
  });
  app.post("/api/conflicts/resolve", async (request, response) => {
    response.json(
      await library.resolveConflict(
        readString(request.body?.path, "path"),
        readString(request.body?.name, "name"),
        readString(request.body?.content, "content", true),
      ),
    );
  });
  app.use("/api", (_request, response) => {
    response
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "本地 API 不存在。" } });
  });

  const distribution = path.resolve("dist");
  app.use(express.static(distribution));
  app.get(["/", "/*path"], async (_request, response, next) => {
    try {
      await fs.access(path.join(distribution, "index.html"));
      response.sendFile(path.join(distribution, "index.html"));
    } catch {
      next();
    }
  });

  const errors: ErrorRequestHandler = async (
    error: unknown,
    request,
    response,
    _next,
  ) => {
    const message = error instanceof Error ? error.message : String(error);
    await library
      .log(
        "api.request",
        "error",
        `${request.method} ${request.path}: ${message}`,
      )
      .catch(() => undefined);
    const status =
      (error as { code?: string }).code === "ENOENT" ||
      (error as { type?: string }).type === "entity.parse.failed"
        ? 400
        : 500;
    response
      .status(status)
      .json({ error: { code: "REQUEST_FAILED", message } });
  };
  app.use(errors);
  return app;
}

function readString(value: unknown, name: string, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw new Error(`请求字段 ${name} 无效。`);
  }
  return value;
}
