# artesia

> Lightweight, fully-typed HTTP framework built on Node.js core — no dependencies except what it actually needs.

[![npm version](https://img.shields.io/npm/v/artesia)](https://www.npmjs.com/package/artesia)
[![license](https://img.shields.io/npm/l/artesia)](./LICENSE)
[![bun](https://img.shields.io/badge/bun-%3E%3D1.0-black)](https://bun.sh)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

Fayde is a minimal HTTP server framework powered by [`node:http`](https://nodejs.org/api/http.html) and the [find-my-way](https://github.com/delvedor/find-my-way) radix-trie router. It gives you typed path params, automatic body parsing, a clean middleware model, and expressive response helpers — without the overhead of a full framework.

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
- [API Reference](#api-reference)
- [License](#license)

---

## Installation

```bash
# npm
npm install artesia

# bun
bun add artesia

# yarn
yarn add artesia
```

**Requirements:** Bun ≥ 1.0 or Node.js ≥ 18.

---

## Create a New Project

The fastest way to get started is with the `create-artesia` scaffolding CLI. It generates a ready-to-run project with your choice of language and package manager.

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
◆  create-http-app
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
import { Fayde } from 'artesia'

const app = new Fayde()

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

You can also use the class directly:

```ts
import { Fayde } from 'artesia'

const app = new Fayde()
```

Both `Artesia()` and `new Fayde()` are identical — use whichever you prefer.

---

## Core Concepts

### Routing

Fayde exposes one method per HTTP verb, plus a generic `add()` for any method. All methods return `this`, so you can chain registrations.

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

**Static string shorthand** — if you pass a string as the first handler, `GET` returns it directly without creating a closure:

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

Route params are defined with `:paramName` syntax and are accessible through `ctx.params.get()`. The type of `ctx.params` is inferred from the route path, so you get full auto-complete.

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

Fayde automatically parses the request body based on `Content-Type`. No configuration needed.

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

Return any value from a handler — Fayde serializes it automatically:

| Return value | HTTP status | Content-Type |
|---|---|---|
| `string` | 200 | `text/plain; charset=utf-8` |
| `object` / `array` | 200 | `application/json; charset=utf-8` |
| `Buffer` | 200 | `application/octet-stream` |
| `null` / `undefined` | 204 | _(no body)_ |
| `FaydeResponse` | as set | as set |

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

**Sharing state across middleware** — use `ctx.store`, a per-request `Map<string, unknown>`:

```ts
app.use(async (ctx, next) => {
  const user = await db.findUserByToken(ctx.cookie('token'))
  ctx.store.set('user', user)
  await next()
})

app.get('/me', (ctx) => ctx.store.get('user'))
```

**Middleware execution order:**

```
Request → mw[0] → mw[1] → ... → route handlers → mw[1] (after next) → mw[0] (after next) → Response
```

---

### Sub-apps & Merging

Create isolated sub-routers with their own `basePath` and merge them into a parent app:

```ts
// users.ts
export const users = new Fayde({ basePath: '/users' })

users
  .get('/', () => listUsers())
  .get('/:id', (ctx) => getUser(ctx.params.get('id')))
  .post('/', (ctx) => createUser(ctx.body))
```

```ts
// app.ts
import { users } from './users'

const app = new Fayde({ basePath: '/api/v1' })

app
  .merge(users)  // → routes mounted at /api/v1/users
  .listen(3000)
```

`merge()` copies both routes and middleware from the merged instance into the parent.

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
ctx.set.status("I'm a Teapot") // 418, yes really
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
const app = new Fayde({
  basePath: '/api/v1', // Prefix prepended to every route (trailing slash stripped automatically)
})
```

---

## Custom Server Integration

Use `app.handler` to plug Fayde into an existing `node:http` server, HTTPS server, or any framework that accepts a standard request handler:

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

  // write to disk, upload to S3, etc.
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
  // ... verify credentials
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

Fayde is written in TypeScript and ships with full type definitions. Path parameters are inferred from the route string at compile time:

```ts
import type { Handler } from 'artesia'

// Explicit typed handler
const getUser: Handler<'/users/:id'> = (ctx) => {
  //                                             ↑ ctx is Context<'/users/:id'>
  ctx.params.get('id')   // ✅ OK
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
  FaydeOptions,     // { basePath?: string }
  FaydeResponse,    // internal response object
  ContextFile,      // uploaded file shape
  CookieOptions,    // set-cookie options
  FileOptions,      // ctx.file() options
  ExtractParams,    // utility: extracts param keys from a path string
  ParamMap,         // typed Map for ctx.params
  HTTPMethod,       // 'GET' | 'POST' | 'PUT' | ...
  HttpStatusText,   // 'OK' | 'Not Found' | 'I'm a Teapot' | ...
  HttpRedirectType, // 301 | 302 | 303 | 307 | 308
  RouteDefinition,  // internal route record
  SetResponse,      // ctx.set interface
} from 'artesia'

import { HTTP_STATUS } from 'artesia' // Record<HttpStatusText, number>
```

---

## Built-in Middleware

Fayde ships first-party middleware for the most common cross-cutting concerns. Import from `artesia/middleware`.

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

Works great for factory-pattern middleware too:

```ts
function rateLimit(maxRpm: number) {
  const counts = new Map<string, number>()

  return buildMiddleware((ctx, next) => {
    const ip = ctx.headers.get('x-forwarded-for') ?? 'unknown'
    const count = (counts.get(ip) ?? 0) + 1
    counts.set(ip, count)
    if (count > maxRpm) {
      ctx.set.status(429)
      return { error: 'Too Many Requests' }
    }
    return next()
  })
}

app.use(rateLimit(60))
```

---

### `cors`

CORS (Cross-Origin Resource Sharing) middleware. Handles both actual requests and `OPTIONS` preflight requests.

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

> **Note:** When `origin` is set to a specific value and a request comes in with a non-matching origin, CORS headers are simply omitted — the browser will block the request. Non-CORS requests (no `Origin` header) pass through unaffected.

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

**Sample output:**

```
2025-01-15 12:34:56.789 GET     /users/42 → 200 (4ms)
2025-01-15 12:34:57.001 POST    /users → 201 (12ms)
2025-01-15 12:34:57.123 DELETE  /users/1 → 404 (2ms)
```

**`LoggerOptions`:**

| Option | Type | Default | Description |
|---|---|---|---|
| `log` | `(line: string, fields: LogFields) => void` | `console.log` | Custom log handler |
| `colorize` | `boolean` | `process.stdout.isTTY` | Enable ANSI colours |
| `skip` | `(fields: { method, pathname }) => boolean` | — | Predicate to skip logging |
| `timestamp` | `'iso' \| 'time' \| false` | `'iso'` | Timestamp format |

**`LogFields`:**

```ts
interface LogFields {
  method:        string        // 'GET', 'POST', ...
  pathname:      string        // '/users/42'
  status:        number        // 200, 404, ...
  durationMs:    number        // response time in ms
  contentLength: string | null // Content-Length header (best-effort)
  timestamp:     string        // formatted timestamp string
}
```

---

## API Reference

### `class Fayde`

| Member | Signature | Description |
|---|---|---|
| `constructor` | `(options?: FaydeOptions)` | Create a new app instance |
| `get` | `(path, ...handlers)` | Register GET route |
| `post` | `(path, ...handlers)` | Register POST route |
| `put` | `(path, ...handlers)` | Register PUT route |
| `patch` | `(path, ...handlers)` | Register PATCH route |
| `delete` | `(path, ...handlers)` | Register DELETE route |
| `head` | `(path, ...handlers)` | Register HEAD route |
| `options` | `(path, ...handlers)` | Register OPTIONS route |
| `add` | `(method, path, ...handlers)` | Register route for any HTTP method |
| `use` | `(middleware: Middleware)` | Add global middleware |
| `merge` | `(other: Fayde)` | Import routes + middleware from another instance |
| `listen` | `(port?, hostname?)` | Start the HTTP server — returns `Promise<{ port, server }>` |
| `handler` | `(req, res) => Promise<void>` | Raw Node.js request handler (for custom server integration) |

### `Artesia(options?)`

Factory function — equivalent to `new Fayde(options)`.

---

## License

MIT © [TiwPhiraphan](https://github.com/TiwPhiraphan)