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
    let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(c) { ctrl = c; },
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
          ctrl?.enqueue(new Uint8Array(event.bytes));
          break;
        case "done":
          ctrl?.close();
          break;
        case "error":
          if (!resolved) { resolved = true; reject(new Error(event.message)); }
          else ctrl?.error(new Error(event.message));
          break;
      }
    };

    invoke("ai_stream_proxy", { url, method, headers, body, channel })
      .catch((e: unknown) => {
        if (!resolved) { resolved = true; reject(e instanceof Error ? e : new Error(String(e))); }
        else ctrl?.error(e);
      });
  });
}
