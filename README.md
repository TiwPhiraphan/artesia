# Artesia

> Lightweight, fully-typed HTTP framework built on Node.js core.

[![npm version](https://img.shields.io/npm/v/artesia)](https://www.npmjs.com/package/artesia)
[![license](https://img.shields.io/npm/l/artesia)](./LICENSE)
[![bun](https://img.shields.io/badge/bun-%3E%3D1.0-black)](https://bun.sh)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

Artesia is a minimal, ultra-fast HTTP server framework powered by [`node:http`](https://nodejs.org/api/http.html) and the [find-my-way](https://github.com/delvedor/find-my-way) radix-trie router. It gives you compile-time typed path parameters, automatic body parsing, scoped sub-apps, first-party middleware, and expressive response helpers — without the overhead or complexity of a heavy framework.

---

## Table of Contents

- [Installation](#installation)
- [Create a New Project](#create-a-new-project)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [Routing](#routing)
  - [Path Parameters](#path-parameters)
  - [Query String](#query-string)
  - [Request Body](#request-body)
  - [Response Serialization](#response-serialization)
  - [Middleware](#middleware)
  - [Sub-apps & Merging](#sub-apps--merging)
- [Error & 404 Handling](#error--404-handling)
  - [Custom Error Handler (`app.onError`)](#custom-error-handler-apponerror)
  - [Custom 404 Handler (`app.notFound`)](#custom-404-handler-appnotfound)
- [Route Grouping](#route-grouping)
- [Context API (`ctx`)](#context-api-ctx)
  - [Request Properties](#request-properties)
  - [Response Helpers](#response-helpers)
  - [`ctx.set` — Mutating the Response](#ctxset--mutating-the-response)
- [Server Options](#server-options)
- [Custom Server Integration](#custom-server-integration)
- [File Uploads](#file-uploads)
- [Cookies](#cookies)
- [TypeScript](#typescript)
- [Built-in Middleware](#built-in-middleware)
  - [buildMiddleware](#buildmiddleware)
  - [cors](#cors)
  - [logger](#logger)
  - [secureHeaders](#secureheaders)
  - [requestId](#requestid)
  - [serveStatic](#servestatic)
- [API Reference](#api-reference)
- [License](#license)

---

## Installation

```bash
# npm
npm install artesia

# bun
bun add artesia

# pnpm
pnpm add artesia

# yarn
yarn add artesia
```

**Requirements:** Bun ≥ 1.0 or Node.js ≥ 18.

---

## Create a New Project

The fastest way to get started is with the scaffolding CLI. It generates a ready-to-run project with your choice of language and package manager.

```bash
# bun
bunx artesia

# npm
npx artesia

# pnpm
pnpm dlx artesia

# yarn
yarn dlx artesia
```

The CLI will walk you through an interactive setup:

```
◆  create-artesia
│
◇  Project name
│  my-app
│
◇  Language
│  ● TypeScript (recommended)
│  ○ JavaScript
│
◇  Package manager
│  ● bun  (detected)
│  ○ pnpm
│  ○ yarn
│  ○ npm
│
◇  Install dependencies?
│  ● Yes  ○ No
│
└  Ready! Happy coding 🚀
```

The generated project structure looks like this:

```
my-app/
├── src/
│   └── index.ts        # entry point with example routes
├── package.json
├── tsconfig.json       # (TypeScript only)
└── .gitignore
```

The generated `src/index.ts` includes a basic working server to get you started immediately:

```ts
import { Artesia } from 'artesia'

const app = Artesia()

app.get('/', (ctx) => {
  return { message: 'Hello World!' }
})

app.get('/users/:id', (ctx) => {
  const id = ctx.params.get('id')
  return { id, name: 'Alice' }
})

app.listen(3000)
```

Then run the dev server:

```bash
# bun
bun dev

# npm / pnpm / yarn
npm run dev
```

---

## Quick Start

```ts
import { Artesia } from 'artesia'

const app = Artesia()

app
  .get('/', 'Hello World')
  .get('/json', () => ({ ok: true }))
  .get('/users/:id', (ctx) => ({
    id: ctx.params.get('id'), // ← fully type-safe
  }))
  .post('/echo', (ctx) => ctx.body)
  .listen(3000)
  .then(({ port }) => console.log(`Listening on http://localhost:${port}`))
```

You can also use the `new` keyword directly if you prefer:

```ts
import { Artesia } from 'artesia'

const app = new Artesia()
```

Both `Artesia()` and `new Artesia()` are identical — use whichever style you prefer.

---

## Core Concepts

### Routing

Artesia exposes one method per HTTP verb, plus a generic `add()` for any method. All methods return `this`, so you can chain registrations.

```ts
app.get('/path', handler)
app.post('/path', handler)
app.put('/path', handler)
app.patch('/path', handler)
app.delete('/path', handler)
app.head('/path', handler)
app.options('/path', handler)
app.add('PURGE', '/path', handler) // any find-my-way HTTPMethod
```

**Static string shorthand** — if you pass a string as the first handler, `GET` returns it directly:

```ts
app.get('/', 'Hello World') // returns "Hello World" as text/plain
```

**Multiple handlers per route** — handlers run in order; the first one that returns a non-`undefined` value short-circuits the rest:

```ts
app.get(
  '/protected',
  (ctx) => {
    if (!ctx.headers.get('authorization')) {
      ctx.set.status(401)
      return { error: 'Unauthorized' }
    }
    // return undefined → continue to next handler
  },
  (ctx) => ({ data: 'secret' })
)
```

---

### Path Parameters

Route params are defined with `:paramName` syntax and are accessible through `ctx.params.get()`. The type of `ctx.params` is inferred from the route path, so you get full TypeScript auto-complete.

```ts
app.get('/users/:id', (ctx) => {
  const id = ctx.params.get('id') // string
  return { id }
})

app.get('/posts/:year/:slug', (ctx) => ({
  year: ctx.params.get('year'),
  slug: ctx.params.get('slug'),
}))
```

**Wildcard routes** use `*`:

```ts
app.get('/static/*', (ctx) => {
  const rest = ctx.params.get('*') // everything after /static/
  return { rest }
})
```

---

### Query String

Access query parameters via the standard `URLSearchParams` API through `ctx.searchParams`:

```ts
app.get('/search', (ctx) => {
  const q    = ctx.searchParams.get('q')
  const page = ctx.searchParams.get('page') ?? '1'
  return { q, page }
})
// GET /search?q=artesia&page=2 → { q: "artesia", page: "2" }
```

---

### Request Body

Artesia automatically parses the request body based on `Content-Type`. No extra configuration or body-parser packages needed.

| Content-Type | `ctx.body` type |
|---|---|
| `application/json` | Parsed object / array / primitive |
| `application/x-www-form-urlencoded` | `Record<string, string \| string[]>` |
| `multipart/form-data` | `Record<string, string>` (fields); files in `ctx.files` |
| `text/*` | `string` |
| Anything else | `Buffer` |
| `GET`, `HEAD`, `OPTIONS` | `null` |

```ts
// JSON body
app.post('/users', (ctx) => {
  const { name, email } = ctx.body as { name: string; email: string }
  return { created: true, name }
})

// URL-encoded form
app.post('/login', (ctx) => {
  const body = ctx.body as Record<string, string>
  return { username: body.username }
})

// Raw buffer (e.g. webhook payload)
app.post('/webhook', (ctx) => {
  const raw = ctx.rawBody // Buffer | null — always available alongside parsed body
  // verify HMAC, etc.
  return null
})
```

---

### Response Serialization

Return any value from a handler — Artesia serializes it automatically:

| Return value | HTTP status | Content-Type |
|---|---|---|
| `string` | 200 | `text/plain; charset=utf-8` |
| `object` / `array` | 200 | `application/json; charset=utf-8` |
| `Buffer` | 200 | `application/octet-stream` |
| `null` / `undefined` | 204 | _(no body)_ |
| `ArtesiaResponse` | as set | as set |

```ts
app.get('/text', () => 'hello')
app.get('/json', () => ({ ok: true }))
app.get('/empty', () => null) // → 204 No Content
app.get('/buffer', () => Buffer.from('raw bytes'))
```

---

### Middleware

Register global middleware with `app.use()`. Each middleware receives `ctx` and a `next` function. Calling `await next()` passes control to the next middleware (and eventually the route handlers).

```ts
// Logging middleware
app.use(async (ctx, next) => {
  const start = Date.now()
  await next()
  console.log(`${ctx.method} ${ctx.pathname} ${Date.now() - start}ms`)
})
```

**Guard / short-circuit** — return a value without calling `next()` to halt the chain:

```ts
app.use((ctx) => {
  const token = ctx.headers.get('authorization')
  if (!token) {
    ctx.set.status(401)
    return { error: 'Unauthorized' }
  }
  // fall through
})
```

**Path-scoped middleware** — scope middleware to run only for paths matching a prefix:

```ts
app.use('/admin', async (ctx, next) => {
  // Runs only for /admin and /admin/* routes
  await next()
})
```

**Sharing state across middleware** — use `ctx.store`, a per-request `Map<string, unknown>`:

```ts
app.use(async (ctx, next) => {
  const user = await db.findUserByToken(ctx.cookie('token'))
  ctx.store.set('user', user)
  await next()
})

app.get('/me', (ctx) => ctx.store.get('user'))
```

---

### Sub-apps & Merging

Create isolated sub-routers with their own `basePath`, then mount them with `.use()` or `.merge()`.

Middleware defined on a sub-app is **scoped to that sub-app's routes only** — it does not leak into other routes.

```ts
// users.ts
export const users = Artesia({ basePath: '/users' })

users
  .use(requireAuth) // runs only for /users routes
  .get('/', () => listUsers())
  .get('/:id', (ctx) => getUser(ctx.params.get('id')))
  .post('/', (ctx) => createUser(ctx.body))
```

```ts
// app.ts
import { users } from './users'

const app = Artesia({ basePath: '/api/v1' })

app
  .use(users)   // → routes mounted at /api/v1/users
  .listen(3000)
```

You can also mount a sub-app under an explicit prefix:

```ts
app.use('/v2', subApp)
```

---

## Error & 404 Handling

### Custom Error Handler (`app.onError`)

Intercept uncaught exceptions thrown in middlewares or handlers:

```ts
app.onError((err, ctx) => {
  console.error('Unhandled Error:', err)
  ctx.set.status(500)
  return {
    error: err.message,
    code: 'INTERNAL_SERVER_ERROR',
  }
})
```

### Custom 404 Handler (`app.notFound`)

Customize the response when no route matches:

```ts
app.notFound((ctx) => {
  return ctx.html('<h1>404 — Page Not Found</h1>', 404)
})
```

---

## Route Grouping

Group routes under a common path prefix with its own scoped middleware using `app.group()`:

```ts
app.group('/v1', (v1) => {
  v1.use(requireAuth)
  v1.get('/users', getUsers)
  v1.get('/posts', getPosts)
})
```

---

## Context API (`ctx`)

The `ctx` object is the single argument passed to every handler and middleware.

### Request Properties

```ts
ctx.request      // IncomingMessage — raw Node.js request object
ctx.method       // 'GET' | 'POST' | 'PUT' | ... (HTTPMethod)
ctx.pathname     // '/users/42' (no query string)
ctx.headers      // Headers (Web API)
ctx.searchParams // URLSearchParams
ctx.params       // ParamMap<Path> — typed by route path
ctx.body         // parsed body (see Body Parsing table)
ctx.rawBody      // Buffer | null
ctx.files        // ContextFile[] — uploaded files
ctx.store        // Map<string, unknown> — per-request shared state
```

**Reading a request cookie:**

```ts
const sessionId = ctx.cookie('session_id') // string | undefined
```

---

### Response Helpers

#### `ctx.html(content, status?)`

Returns an HTML response with `Content-Type: text/html; charset=utf-8`.

```ts
app.get('/page', (ctx) =>
  ctx.html('<h1>Hello</h1>', 200)
)
```

#### `ctx.file(filePath, options?)`

Reads a file from disk and returns it with the correct MIME type (auto-detected from extension). Supports 30+ MIME types out of the box.

```ts
app.get('/download', (ctx) =>
  ctx.file('./uploads/report.pdf', {
    disposition: 'attachment',
    filename: 'report.pdf',
  })
)

app.get('/logo', (ctx) =>
  ctx.file('./public/logo.png') // disposition: 'inline' by default
)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `contentType` | `string` | auto-detected | Override MIME type |
| `filename` | `string` | — | Sets `filename=` in `Content-Disposition` |
| `disposition` | `'inline' \| 'attachment'` | `'inline'` | Controls download behaviour |

#### `ctx.redirect(path, status?)`

Returns a redirect response.

```ts
app.get('/old', (ctx) => ctx.redirect('/new', 301))
app.get('/go', (ctx) => ctx.redirect('https://example.com'))
```

| Status | Meaning |
|---|---|
| `301` | Moved Permanently |
| `302` | Found (default) |
| `303` | See Other |
| `307` | Temporary Redirect |
| `308` | Permanent Redirect |

---

### `ctx.set` — Mutating the Response

`ctx.set` provides a fluent API to configure the outgoing response before returning from a handler.

#### `ctx.set.status(status)`

Accepts either a numeric status code or an HTTP status text string (fully typed):

```ts
ctx.set.status(201)
ctx.set.status('Created')
ctx.set.status(404)
ctx.set.status('Not Found')
ctx.set.status("I'm a Teapot") // 418
```

#### `ctx.set.headers(...)`

Three call signatures:

```ts
// Single header
ctx.set.headers('x-request-id', 'abc-123')

// Object / record
ctx.set.headers({ 'x-foo': 'bar', 'cache-control': 'no-cache' })

// Map or Headers instance
ctx.set.headers(new Headers({ 'x-custom': 'value' }))
```

#### `ctx.set.cookies(...)`

Set one or multiple cookies with optional options:

```ts
// Single cookie
ctx.set.cookies('token', 'abc123', {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: 60 * 60 * 24, // 1 day in seconds
  path: '/',
})

// Multiple cookies
ctx.set.cookies(
  { session: 'xyz', theme: 'dark' },
  { httpOnly: true }
)
```

**Cookie options:**

| Option | Type | Description |
|---|---|---|
| `maxAge` | `number` | Max age in seconds |
| `expires` | `Date` | Expiry date |
| `httpOnly` | `boolean` | Prevents JS access |
| `secure` | `boolean` | HTTPS only |
| `sameSite` | `'strict' \| 'lax' \| 'none'` | SameSite policy |
| `path` | `string` | Cookie path |
| `domain` | `string` | Cookie domain |

---

## Server Options

```ts
const app = Artesia({
  basePath: '/api/v1',          // Prefix prepended to every route (trailing slash stripped automatically)
  poweredBy: 'Artesia',         // Value for X-Powered-By header (default: 'Artesia', set false to disable)
  maxBodySize: 10 * 1024 * 1024 // Maximum request body size in bytes (default: 10MB)
})
```

---

## Custom Server Integration

Use `app.handler` to plug Artesia into an existing `node:http` server, HTTPS server, or any framework that accepts a standard request handler:

```ts
import { createServer } from 'node:http'
import { createServer as createHttps } from 'node:https'
import { readFileSync } from 'node:fs'
import { Artesia } from 'artesia'

const app = Artesia()
app.get('/health', () => ({ status: 'ok' }))

// HTTP
createServer(app.handler).listen(3000)

// HTTPS
createHttps(
  { key: readFileSync('key.pem'), cert: readFileSync('cert.pem') },
  app.handler
).listen(443)
```

To gracefully stop the server:

```ts
await app.close()
```

---

## File Uploads

Multipart form uploads are parsed automatically via [busboy](https://github.com/mscdex/busboy). Access uploaded files through `ctx.files`:

```ts
app.post('/upload', (ctx) => {
  const file = ctx.files[0]

  if (!file) {
    ctx.set.status(400)
    return { error: 'No file uploaded' }
  }

  console.log(file.fieldname)  // form field name
  console.log(file.filename)   // original filename
  console.log(file.mimetype)   // e.g. 'image/png'
  console.log(file.encoding)   // e.g. '7bit'
  console.log(file.size)       // byte length
  console.log(file.buffer)     // Buffer containing file data

  return { uploaded: file.filename }
})
```

**`ContextFile` shape:**

```ts
interface ContextFile {
  fieldname: string
  filename:  string
  mimetype:  string
  encoding:  string
  buffer:    Buffer
  size:      number
}
```

---

## Cookies

**Reading cookies** from the request:

```ts
app.get('/profile', (ctx) => {
  const session = ctx.cookie('session_id')
  if (!session) {
    ctx.set.status(401)
    return { error: 'Not authenticated' }
  }
  return { sessionId: session }
})
```

**Setting cookies** in the response via `ctx.set.cookies()`:

```ts
app.post('/login', (ctx) => {
  ctx.set.cookies('session_id', 'generated-session-token', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 1 week
  })
  ctx.set.status(200)
  return { ok: true }
})
```

---

## TypeScript

Artesia is written in TypeScript and ships with full type definitions. Path parameters are inferred from the route string at compile time:

```ts
import type { Handler } from 'artesia'

// Explicit typed handler
const getUser: Handler<'/users/:id'> = (ctx) => {
  ctx.params.get('id')   // ✅ OK
  // @ts-expect-error
  ctx.params.get('name') // ❌ Type error — 'name' not in params
}

app.get('/users/:id', getUser)
```

**Exported types:**

```ts
import type {
  Context,          // ctx passed to handlers
  Handler,          // (ctx: Context<Path>) => unknown | Promise<unknown>
  Middleware,       // (ctx: Context, next: () => Promise<void>) => unknown
  ErrorHandler,     // (err: Error, ctx: Context) => unknown
  NotFoundHandler,  // (ctx: Context) => unknown
  ArtesiaOptions,   // { basePath?, poweredBy?, maxBodySize? }
  ArtesiaResponse,  // internal response object
  ContextFile,      // uploaded file shape
  CookieOptions,    // set-cookie options
  FileOptions,      // ctx.file() options
  ExtractParams,    // utility: extracts param keys from a path string
  ParamMap,         // typed Map for ctx.params
  HTTPMethod,       // 'GET' | 'POST' | 'PUT' | ...
  HttpStatusText,   // 'OK' | 'Not Found' | 'I\'m a Teapot' | ...
  HttpRedirectType, // 301 | 302 | 303 | 307 | 308
  RouteDefinition,  // internal route record
  SetResponse,      // ctx.set interface
} from 'artesia'

import { HTTP_STATUS } from 'artesia' // Record<HttpStatusText, number>
```

---

## Built-in Middleware

Artesia ships first-party middleware for the most common cross-cutting concerns. Import from `artesia/middleware`.

---

### `buildMiddleware`

A typed helper for authoring middleware. Pass your function in and get it back as a correctly-typed `Middleware` — no need to import or annotate the type yourself.

```ts
import { buildMiddleware } from 'artesia/middleware'

const requireAuth = buildMiddleware((ctx, next) => {
  const token = ctx.headers.get('authorization')
  if (!token) {
    ctx.set.status(401)
    return { error: 'Unauthorized' }
  }
  return next()
})

app.use(requireAuth)
```

---

### `cors`

CORS (Cross-Origin Resource Sharing) middleware. Handles both actual requests and preflight `OPTIONS` requests automatically.

```ts
import { cors } from 'artesia/middleware'

// Allow all origins (default)
app.use(cors())

// Restrict to specific origins
app.use(cors({
  origin: ['https://example.com', 'https://admin.example.com'],
  credentials: true,
}))

// Regex or custom predicate
app.use(cors({
  origin: /\.example\.com$/,
}))
```

**`CorsOptions`:**

| Option | Type | Default | Description |
|---|---|---|---|
| `origin` | `'*' \| string \| string[] \| RegExp \| ((o: string) => boolean)` | `'*'` | Allowed origin(s) |
| `methods` | `string[]` | All standard methods | Allowed HTTP methods |
| `allowedHeaders` | `string[]` | Reflects `Access-Control-Request-Headers` | Allowed request headers |
| `exposedHeaders` | `string[]` | — | Headers exposed to the browser |
| `credentials` | `boolean` | `false` | Allow cookies / credentials |
| `maxAge` | `number` | `5` | Preflight cache TTL in seconds |

---

### `logger`

HTTP request logger. Prints method, path, status code, and response time for every request.

```ts
import { logger } from 'artesia/middleware'

// Pretty coloured output (auto-detects TTY)
app.use(logger())

// Structured JSON logging
app.use(logger({
  log: (_, fields) => console.log(JSON.stringify(fields)),
}))

// Skip noisy endpoints
app.use(logger({
  skip: ({ pathname }) => pathname === '/health' || pathname.startsWith('/static/'),
}))

// No timestamp, plain text
app.use(logger({ timestamp: false, colorize: false }))
```

**`LoggerOptions`:**

| Option | Type | Default | Description |
|---|---|---|---|
| `log` | `(line: string, fields: LogFields) => void` | `console.log` | Custom log handler |
| `colorize` | `boolean` | `process.stdout.isTTY` | Enable ANSI colours |
| `skip` | `(fields: { method, pathname }) => boolean` | — | Predicate to skip logging |
| `timestamp` | `'iso' \| 'time' \| false` | `'iso'` | Timestamp format |

---

### `secureHeaders`

Sets essential security HTTP response headers (similar to Helmet):

```ts
import { secureHeaders } from 'artesia/middleware'

app.use(secureHeaders())
```

**Default headers applied:**
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `X-XSS-Protection: 0`
- `Referrer-Policy: strict-origin-when-cross-origin`

Supports options to enable HSTS, Content-Security-Policy, or customize any header.

---

### `requestId`

Generates or propagates a request tracing ID via `X-Request-Id`:

```ts
import { requestId } from 'artesia/middleware'

app.use(requestId())

app.get('/trace', (ctx) => {
  return { id: ctx.store.get('requestId') }
})
```

---

### `serveStatic`

Serves static files from a local directory with automatic MIME detection and path traversal protection:

```ts
import { serveStatic } from 'artesia/middleware'

// Serves static files under /static
app.use('/static', serveStatic({ root: './public' }))
```

---

## API Reference

### `class Artesia`

| Member | Signature | Description |
|---|---|---|
| `constructor` | `(options?: ArtesiaOptions)` | Create a new app instance |
| `get` | `(path, ...handlers)` | Register GET route |
| `post` | `(path, ...handlers)` | Register POST route |
| `put` | `(path, ...handlers)` | Register PUT route |
| `patch` | `(path, ...handlers)` | Register PATCH route |
| `delete` | `(path, ...handlers)` | Register DELETE route |
| `head` | `(path, ...handlers)` | Register HEAD route |
| `options` | `(path, ...handlers)` | Register OPTIONS route |
| `add` | `(method, path, ...handlers)` | Register route for any HTTP method |
| `use` | `(middleware: Middleware)` | Add global middleware |
| `use` | `(prefix: string, middleware: Middleware)` | Add path-scoped middleware |
| `use` | `(app: Artesia)` | Mount a sub-app (middleware scoped to its routes) |
| `use` | `(prefix: string, app: Artesia)` | Mount a sub-app under an explicit prefix |
| `merge` | `(other: Artesia, prefix?: string)` | Mount a sub-app — same as `.use(subApp)` |
| `group` | `(prefix: string, fn: (group: Artesia) => void)` | Group routes under a common path prefix |
| `onError` | `(handler: ErrorHandler)` | Register a custom error handler |
| `notFound` | `(handler: NotFoundHandler)` | Register a custom 404 handler |
| `listen` | `(port?, hostname?)` | Start the HTTP server — returns `Promise<{ port, server }>` |
| `close` | `() => Promise<void>` | Stop the running HTTP server |
| `handler` | `(req, res) => Promise<void>` | Raw Node.js request handler (for custom server integration) |

### `Artesia(options?)`

Factory function — equivalent to `new Artesia(options)`.

---

## License

MIT © [TiwPhiraphan](https://github.com/TiwPhiraphan)
