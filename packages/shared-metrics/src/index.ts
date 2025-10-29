import Fastify, { FastifyInstance } from "fastify";

type Counters = Record<string, number>;

export const metrics: {
  service: string;
  startedAt: string;
  lastMessageAt: string | null;
  counters: Counters;
} = {
  service: process.env.SERVICE_NAME || "unknown",
  startedAt: new Date().toISOString(),
  lastMessageAt: null,
  counters: {},
};

export function inc(name: string, by = 1) {
  metrics.counters[name] = (metrics.counters[name] || 0) + by;
}

export async function startMetricsServer(port: number): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true, service: metrics.service }));

  app.get("/metrics", async (_req, reply) => {
    // Always send JSON body
    return reply.header("content-type", "application/json").send({
      service: metrics.service,
      startedAt: metrics.startedAt,
      lastMessageAt: metrics.lastMessageAt,
      counters: metrics.counters,
    });
  });

  // IMPORTANT: bind to 0.0.0.0 so it’s reachable from host through Docker port mapping
  await app.listen({ port, host: "0.0.0.0" });

  // small console noise to confirm at boot
  // eslint-disable-next-line no-console
  console.log(`[metrics] ${metrics.service} listening on 0.0.0.0:${port}`);

  return app;
}
