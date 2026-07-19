import { Hono } from "hono";
import { handle } from "hono/vercel";
import notionRoute from "./routes/notion.js";

const app = new Hono();

app.get("/", (c) => c.text("Larkup OAuth Proxy API is running."));

const apiApp = new Hono();
apiApp.get("/health", (c) => c.json({ status: "ok", service: "larkup-proxy" }));

// Register integrations routes
apiApp.route("/oauth/notion", notionRoute);

app.route("/api", apiApp);

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
