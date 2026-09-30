// This gateway transports the existing API. The Node backend owns authentication,
// persistence, calculation, jobs and mathematical result provenance.
const forwardedHeaders = [
  'accept', 'content-type', 'authorization', 'x-webhook-signature',
  'x-theibs-remote-text-consent'
];

function failure(status, code, reason) {
  return Response.json({ status: 'ERROR', code, reason }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  });
}

export function upstreamOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash ||
      url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
      url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
    throw new Error('API_UPSTREAM must be a fixed HTTPS origin.');
  }
  return url.origin;
}

export function createGateway(fetchUpstream = fetch, timeoutMs = 60000) {
  return {
    async fetch(request, env) {
      const incoming = new URL(request.url);
      const api = incoming.pathname === '/api' || incoming.pathname.startsWith('/api/');
      if (!api && incoming.pathname !== '/healthz') {
        if (!['GET', 'HEAD'].includes(request.method)) {
          return failure(405, 'METHOD_NOT_ALLOWED', 'Use GET or HEAD for page requests.');
        }
        const asset = new URL(incoming);
        if (asset.pathname === '/') asset.pathname = '/landing.html';
        if (asset.pathname === '/app' || asset.pathname === '/app/') asset.pathname = '/index.html';
        const response = await env.ASSETS.fetch(new Request(asset, request));
        const headers = new Headers(response.headers);
        headers.set('X-Content-Type-Options', 'nosniff');
        // Match the existing release policy for unversioned application files.
        headers.set('Cache-Control', 'no-store');
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      }

      // Validate the browser origin before translating it for the existing
      // same-origin backend. No caller can choose the upstream destination.
      const origin = request.headers.get('origin');
      if (origin !== null && origin !== incoming.origin) {
        return failure(403, 'ORIGIN_NOT_ALLOWED', 'Origin not allowed.');
      }
      let target;
      try {
        target = new URL(upstreamOrigin(env.API_UPSTREAM));
        target.pathname = incoming.pathname;
        target.search = incoming.search;
      } catch {
        return failure(503, 'UPSTREAM_CONFIGURATION', 'The calculation service is not configured.');
      }
      const headers = new Headers();
      for (const name of forwardedHeaders) {
        const value = request.headers.get(name);
        if (value !== null) headers.set(name, value);
      }
      if (origin !== null) headers.set('origin', target.origin);
      const controller = new AbortController();
      const cancel = () => controller.abort(request.signal.reason);
      if (request.signal.aborted) cancel();
      else request.signal.addEventListener('abort', cancel, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      let streaming = false, abortBody;
      const cleanup = () => {
        clearTimeout(timer);
        request.signal.removeEventListener('abort', cancel);
        if (abortBody) controller.signal.removeEventListener('abort', abortBody);
      };
      try {
        const response = await fetchUpstream(target, {
          method: request.method, headers,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
          signal: controller.signal, redirect: 'manual', duplex: 'half',
          cache: 'no-store'
        });
        // Workers implements follow/manual, not the browser's redirect:error.
        // Never follow a redirect while transporting a user's bearer token.
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          return failure(502, 'UPSTREAM_REDIRECT', 'The calculation service returned an unexpected redirect.');
        }
        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('Cache-Control', 'no-store');
        responseHeaders.set('X-Content-Type-Options', 'nosniff');
        // The app uses this same-origin endpoint. Never broaden access based
        // on upstream CORS headers or set authentication cookies at a new host.
        for (const name of [...responseHeaders.keys()]) {
          if (name.startsWith('access-control-') || name === 'set-cookie') responseHeaders.delete(name);
        }
        let body = null;
        if (response.body) {
          const reader = response.body.getReader();
          body = new ReadableStream({
            start(output) {
              abortBody = () => {
                output.error(new Error('API transport was interrupted.'));
                void reader.cancel().catch(() => {});
                cleanup();
              };
              controller.signal.addEventListener('abort', abortBody, { once: true });
              if (controller.signal.aborted) abortBody();
            },
            async pull(output) {
              try {
                const chunk = await reader.read();
                if (controller.signal.aborted) return;
                if (chunk.done) { cleanup(); output.close(); }
                else output.enqueue(chunk.value);
              } catch (error) { cleanup(); output.error(error); }
            },
            cancel(reason) {
              cleanup(); controller.abort(reason);
              return reader.cancel(reason);
            }
          });
          streaming = true;
        }
        return new Response(body, {
          status: response.status, statusText: response.statusText, headers: responseHeaders
        });
      } catch {
        return failure(timedOut ? 504 : 502, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
          timedOut ? 'The calculation service did not respond in time. Try again.' : 'The calculation service could not be reached. Try again.');
      } finally {
        if (!streaming) cleanup();
      }
    }
  };
}

export default createGateway();
