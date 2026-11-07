/** Run cleanup once on SIGINT/SIGTERM so containers stop without losing in-flight work. */
export function onShutdown(log: (msg: string) => void, cleanup: () => Promise<void>): void {
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`${signal} received, shutting down`);
    try {
      await cleanup();
      process.exit(0);
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}
