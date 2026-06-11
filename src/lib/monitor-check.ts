export type MonitorCheckResult = {
  status: "up" | "down";
  responseTimeMs: number;
  errorMessage: string | null;
};

export async function checkMonitorUrl(url: string): Promise<MonitorCheckResult> {
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    const isServiceReachable = response.status >= 200 && response.status < 500;
    return {
      status: isServiceReachable ? "up" : "down",
      responseTimeMs: Date.now() - startedAt,
      errorMessage: isServiceReachable ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      status: "down",
      responseTimeMs: Date.now() - startedAt,
      errorMessage: error instanceof Error && error.name === "AbortError" ? "Timeout" : "Request failed",
    };
  }
}
