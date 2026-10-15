import type { useCerbos } from "@/components/CerbosContext";
import { principals, resources } from "@/constants/data";

type Cerbos = ReturnType<typeof useCerbos>;

export interface LatencyStats {
  p50: number;
  p95: number;
  mean: number;
}

export interface LatencyReport {
  /** One `isAllowed` call at a time. */
  sequential: LatencyStats;
  /** 20 concurrent `isAllowed` calls (a screen rendering a list); time until all resolve. */
  burstOf20: LatencyStats;
  /** One `checkResources` call with 10 resources at a time. */
  checkResources10: LatencyStats;
}

function stats(samples: number[]): LatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    mean: round(samples.reduce((a, b) => a + b, 0) / samples.length),
  };
}

async function time(fn: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await fn();
  return performance.now() - started;
}

/**
 * Measures how long decisions take to reach the UI: from calling the
 * `useCerbos()` method to its promise resolving.
 */
export async function runLatencyBenchmark(
  cerbos: Cerbos
): Promise<LatencyReport> {
  const isAllowed = () =>
    cerbos.isAllowed({
      principal: principals[0],
      resource: resources[1],
      action: "update",
    });

  for (let i = 0; i < 20; i++) {
    await isAllowed();
  }

  const sequential: number[] = [];
  for (let i = 0; i < 200; i++) {
    sequential.push(await time(isAllowed));
  }

  const burst: number[] = [];
  for (let i = 0; i < 30; i++) {
    burst.push(
      await time(() => Promise.all(Array.from({ length: 20 }, isAllowed)))
    );
  }

  const tenResources = Array.from({ length: 10 }, (_, i) => ({
    resource: { ...resources[i % resources.length], id: `doc${i}` },
    actions: ["read", "update", "delete"],
  }));
  const batch: number[] = [];
  for (let i = 0; i < 100; i++) {
    batch.push(
      await time(() =>
        cerbos.checkResources({
          principal: principals[0],
          resources: tenResources,
        })
      )
    );
  }

  return {
    sequential: stats(sequential),
    burstOf20: stats(burst),
    checkResources10: stats(batch),
  };
}
