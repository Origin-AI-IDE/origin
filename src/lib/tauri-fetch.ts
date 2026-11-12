import { invoke, Channel } from "@tauri-apps/api/core";

type ProxyEvent =
  | { type: "status";  code: number; headers: [string, string][] }
  | { type: "chunk";   bytes: number[] }
  | { type: "done" }
  | { type: "error";   message: string };

export async function tauriFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string" ? input
    : input instanceof URL    ? input.href
    : (input as Request).url;

  const method = init?.method ?? (init?.body ? "POST" : "GET");
  const requestId = crypto.randomUUID();
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);

  const headers: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers as [string, string][]) headers[k] = v;
    } else {
      Object.assign(headers, init.headers as Record<string, string>);
    }
  }

  let body: string | undefined;
  if (init?.body != null) {
    if (typeof init.body === "string") {
      body = init.body;
    } else if (init.body instanceof Uint8Array) {
      body = new TextDecoder().decode(init.body);
    } else if (init.body instanceof ArrayBuffer) {
      body = new TextDecoder().decode(new Uint8Array(init.body));
    } else {
      body = String(init.body);
    }
  }

  return new Promise<Response>((resolve, reject) => {
    let resolved = false;
    let streamTerminated = false;
    let proxyReady = false;
    let abortRequested = false;
    let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const failStream = (error: unknown) => {
      if (!streamTerminated) {
        streamTerminated = true;
        ctrl?.error(error);
      }
    };
    const cancelProxy = () => {
      abortRequested = true;
      if (proxyReady) {
        void invoke("cancel_ai_stream_proxy", { requestId }).catch(console.error);
      }
    };
    const onAbort = () => {
      cancelProxy();
      const error = new DOMException("The operation was aborted", "AbortError");
      if (!resolved) {
        resolved = true;
        streamTerminated = true;
        cleanup();
        reject(error);
      } else {
        failStream(error);
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(c) { ctrl = c; },
      cancel() {
        streamTerminated = true;
        cleanup();
        cancelProxy();
      },
    });

    const channel = new Channel<ProxyEvent>();
    channel.onmessage = (event) => {
      switch (event.type) {
        case "status": {
          const h = new Headers();
          for (const [k, v] of event.headers) h.append(k, v);
          if (!resolved) {
            resolved = true;
            resolve(new Response(stream, { status: event.code, headers: h }));
          }
          break;
        }
        case "chunk":
          if (!streamTerminated) ctrl?.enqueue(new Uint8Array(event.bytes));
          break;
        case "done":
          cleanup();
          if (!streamTerminated) {
            streamTerminated = true;
            ctrl?.close();
          }
          break;
        case "error":
          cleanup();
          if (!resolved) {
            resolved = true;
            streamTerminated = true;
            reject(new Error(event.message));
          }
          else failStream(new Error(event.message));
          break;
      }
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    invoke("ai_stream_proxy", { url, method, headers, body, requestId, channel })
      .then(() => {
        proxyReady = true;
        if (abortRequested) {
          void invoke("cancel_ai_stream_proxy", { requestId }).catch(console.error);
        }
      })
      .catch((e: unknown) => {
        cleanup();
        if (!resolved) {
          resolved = true;
          streamTerminated = true;
          reject(e instanceof Error ? e : new Error(String(e)));
        }
        else failStream(e);
      });
  });
}

export function customApiFetch(baseUrl: string): typeof tauriFetch {
  let registration: Promise<void> | undefined;
  return (input, init) => {
    registration ??= invoke<void>("register_custom_api_endpoint", { baseUrl });
    return registration.then(() => tauriFetch(input, init));
  };
}
