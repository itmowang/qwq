export const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "if-match",
  "if-none-match",
  "x-request-id",
] as const;

export type ProxyRequest = {
  path: string;
  method: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
};

function getUpstreamBaseUrl(): URL {
  const configuredUrl = process.env.PORTMAX_UPSTREAM_BASE_URL;

  if (!configuredUrl) {
    throw new Error("PORTMAX_UPSTREAM_BASE_URL is required before proxying requests.");
  }

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("PORTMAX_UPSTREAM_BASE_URL must be an absolute HTTP(S) URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PORTMAX_UPSTREAM_BASE_URL must use HTTP or HTTPS.");
  }

  return url;
}

function resolveTargetUrl(path: string): URL {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("The proxy path must be an absolute path on the configured upstream.");
  }

  const target = new URL(path, getUpstreamBaseUrl());
  const upstream = getUpstreamBaseUrl();

  if (target.origin !== upstream.origin) {
    throw new Error("Proxy paths must resolve to the configured upstream origin.");
  }

  return target;
}

export function selectForwardHeaders(source: Headers): Headers {
  const selected = new Headers();

  for (const headerName of FORWARDED_REQUEST_HEADERS) {
    const value = source.get(headerName);
    if (value) selected.set(headerName, value);
  }

  return selected;
}

export function selectResponseHeaders(source: Headers): Headers {
  const selected = new Headers();

  for (const headerName of ["content-type", "cache-control", "etag", "last-modified", "x-request-id"]) {
    const value = source.get(headerName);
    if (value) selected.set(headerName, value);
  }

  return selected;
}

/** Sends a request only to the configured upstream origin. */
export async function forwardUpstream(request: ProxyRequest): Promise<Response> {
  const headers = new Headers(request.headers);
  const configuredAuthorization = process.env.PORTMAX_UPSTREAM_AUTHORIZATION;

  if (configuredAuthorization) {
    headers.set("authorization", configuredAuthorization);
  }

  return fetch(resolveTargetUrl(request.path), {
    method: request.method.toUpperCase(),
    headers,
    body: request.body,
  });
}
