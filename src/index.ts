import { handle } from './router.ts';

// The entire coupling to the runtime and to the host. Deno Deploy routes to whatever
// port the isolate listens on, but PORT is the platform-agnostic contract and keeps the
// local override that `deno task dev` documents — one line to stay portable.
Deno.serve({
  hostname: '0.0.0.0',
  port: Number(Deno.env.get('PORT') ?? 8080),
}, handle);
