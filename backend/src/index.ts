import "dotenv/config";
import express from "express";
import cors from "cors";
import { chatRouter } from "./routes/chat";
import { projectsRouter } from "./routes/projects";
import { projectChatRouter } from "./routes/projectChat";
import { documentsRouter } from "./routes/documents";
import { tabularRouter } from "./routes/tabular";
import { workflowsRouter } from "./routes/workflows";
import { userRouter } from "./routes/user";
import { downloadsRouter } from "./routes/downloads";
import { legalRouter } from "./routes/legal";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
    credentials: true,
  }),
);

app.use(express.json({ limit: "50mb" }));

app.use("/chat", chatRouter);
app.use("/projects", projectsRouter);
app.use("/projects/:projectId/chat", projectChatRouter);
app.use("/single-documents", documentsRouter);
app.use("/tabular-review", tabularRouter);
app.use("/workflows", workflowsRouter);
app.use("/user", userRouter);
app.use("/users", userRouter);
app.use("/download", downloadsRouter);
app.use("/legal", legalRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

// Global error handler — catches unhandled async errors from route handlers
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[unhandled error]", err);
    res.status(500).json({ detail: String(err) });
  },
);

app.listen(PORT, () => {
  console.log(`Mike backend running on port ${PORT}`);
  console.log(`  SUPABASE_URL: ${process.env.SUPABASE_URL ? "set" : "MISSING"}`);
  console.log(`  SUPABASE_SECRET_KEY: ${process.env.SUPABASE_SECRET_KEY ? "set (starts with " + (process.env.SUPABASE_SECRET_KEY ?? "").slice(0, 10) + "...)" : "MISSING"}`);
  console.log(`  FRONTEND_URL: ${process.env.FRONTEND_URL ?? "(not set)"}`);
});
