import axios from "axios";

const SAFE_METHODS = new Set(["get", "head", "options"]);

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(new axios.CanceledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}

// A retry shares the original deadline. Writes are never replayed.
export function installRequestRecovery(client, { now = () => performance.now(), wait = sleep, budgetMs = 30000 } = {}) {
  client.interceptors.request.use(config => {
    config.__deadline ??= now() + (config.retryBudgetMs ?? budgetMs);
    config.__attemptTimeout ??= config.timeout || 15000;
    const remaining = config.__deadline - now();
    if (remaining <= 0) throw new axios.AxiosError("Request deadline reached", "ECONNABORTED", config);
    config.timeout = Math.max(1, Math.min(config.__attemptTimeout, remaining));
    return config;
  });
  client.interceptors.response.use(undefined, async error => {
    const config = error.config;
    if (!config || axios.isCancel(error) || config.signal?.aborted || config.noRetry
      || !SAFE_METHODS.has(String(config.method || "get").toLowerCase())
      || (error.response && error.response.status < 500)) throw error;
    const attempts = config.__retryCount || 0;
    const delay = [800, 1800, 3000][Math.min(attempts, 2)];
    if (attempts >= (config.retryLimit ?? 2) || config.__deadline - now() <= delay) throw error;
    config.__retryCount = attempts + 1;
    await wait(delay, config.signal);
    return client(config);
  });
}
