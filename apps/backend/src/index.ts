import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.router";
import { warehousesRouter } from "./routes/warehouses.router";
import { itemsRouter } from "./routes/items.router";
import { binsRouter } from "./routes/bins.router";
import { lotsRouter } from "./routes/lots.router";
import { lookupRouter } from "./routes/lookup.router";
import { pickRouter } from "./routes/pick.router";
import { transactionsRouter } from "./routes/transactions.router";
import { stockRouter } from "./routes/stock.router";
import { countsRouter } from "./routes/counts.router";
import { movementsRouter } from "./routes/movements.router";
import { usersRouter } from "./routes/users.router";
import { auditRouter } from "./routes/audit.router";
import { adminRouter } from "./routes/admin.router";
import { labelsRouter } from "./routes/labels.router";
import { dashboardRouter } from "./routes/dashboard.router";

const app = express();

const PORT = Number(process.env.PORT ?? 4100);
// Comma-separated allowed origins for the static frontend (IIS) + dev.
const ORIGINS = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: ORIGINS,
    credentials: true,
  }),
);
app.use(express.json({ limit: "5mb" }));

// Liveness probe (no auth).
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "king-wms-api" });
});

// ---- Mounted routers ----
app.use("/api/auth", authRouter);
app.use("/api/warehouses", warehousesRouter);
app.use("/api/items", itemsRouter);
app.use("/api/bins", binsRouter);
app.use("/api/lots", lotsRouter);
app.use("/api/lookup", lookupRouter);
app.use("/api/pick", pickRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/stock", stockRouter);
app.use("/api/counts", countsRouter);
app.use("/api/movements", movementsRouter);
app.use("/api/users", usersRouter);
app.use("/api/audit", auditRouter);
app.use("/api/admin", adminRouter);
app.use("/api/labels", labelsRouter);
app.use("/api/dashboard", dashboardRouter);

app.listen(PORT, () => {
  console.log(`[king-wms-api] listening on http://localhost:${PORT}`);
});
