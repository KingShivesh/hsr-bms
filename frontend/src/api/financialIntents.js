function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function createFinancialIntents({ storage, crypto, identity }) {
  return {
    async prepare(config) {
      const bytes = new TextEncoder().encode(JSON.stringify(canonical({ identity: identity(), url: config.url, method: config.method, data: config.data ?? null })));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
      const slot = `hsr:financial-intent:${hash}`;
      const existing = storage().getItem(slot);
      const key = existing || [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, "0")).join("");
      storage().setItem(slot, key);
      config.__financialIntentSlot = slot;
      config.headers["Idempotency-Key"] = key;
      return config;
    },
    settle(config, status) {
      if (!config?.__financialIntentSlot) return;
      // Keep uncertain responses and conflicts recoverable across a page reload.
      if ((status >= 200 && status < 300) || [400, 401, 403, 404, 422, 428].includes(status)) storage().removeItem(config.__financialIntentSlot);
    },
  };
}

export function isFinancialRequest(config) {
  return String(config.method).toLowerCase() === "post" && /^\/(food\/order(?:\?|$)|sessions\/(start|pause\/[^/?]+|stop\/[^/?]+|[^/?]+\/food(?:-order)?)(?:\?|$))/.test(config.url || "");
}
