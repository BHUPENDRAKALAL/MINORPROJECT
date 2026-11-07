import { createServer } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { loadEnv } from "../config/env.ts";
import { createRedis } from "../lib/redis.ts";
import { onShutdown } from "./shutdown.ts";

/**
 * Process 2 of 4: live updates over Socket.io (interview line, rotating QR, job progress).
 * The Redis adapter lets several copies of this process share rooms, so it can scale out.
 *
 * Rooms (BACKEND-DESIGN.md §9): user:{id} · drive:{id} · panel:{id} · attendance:{sessionId}
 * Auth on connect is added together with the auth module.
 */
const env = loadEnv();
const pub = createRedis(env.REDIS_URL, "pubsub");
const sub = pub.duplicate();

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(404).end();
});

const io = new Server(http, {
  cors: { origin: env.CORS_ORIGINS, credentials: true },
  adapter: createAdapter(pub, sub),
});

io.on("connection", (socket) => {
  socket.emit("hello", { serverTime: new Date().toISOString() });
});

onShutdown((m) => console.log(`[realtime] ${m}`), async () => {
  await new Promise<void>((resolve) => io.close(() => resolve()));
  pub.disconnect();
  sub.disconnect();
});

http.listen(env.REALTIME_PORT, () => console.log(`[realtime] listening on :${env.REALTIME_PORT}`));
