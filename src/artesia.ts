import { createServer, type Server } from 'node:http'
import { parse as parseCookie } from 'cookie'
import type { HTTPMethod, Instance } from 'find-my-way'
import Router from 'find-my-way'
import { parseBody } from './body-parser'
import { buildContext, getResponseMeta } from './context'
import { sendValue } from './response'
import type { ArtesiaOptions, Context, Handler, Middleware, RouteDefinition } from './types'

export type { HTTPMethod }

type AnyHandler = Handler<string>

type RouteStub = { (): void; __handlers: AnyHandler[]; __instanceMiddlewares: Middleware[] }

/**
 * The core Artesia application class.
 *
 * @example
 * ```ts
 * const app = new Artesia({ basePath: '/api' })
 * app.use(logger()).get('/users', getUsers).listen(3000)
 * ```
 */
export class Artesia {
	private readonly basePath: string
	private readonly middlewares: Middleware[] = []
	private readonly routes: RouteDefinition[] = []
	private _router: Instance<Router.HTTPVersion.V1> | null = null
	/**
	 * @param options.basePath - Optional path prefix applied to every route on this instance.
	 */
	constructor(options: ArtesiaOptions = {}) {
		this.basePath = options.basePath?.replace(/\/+$/, '') ?? ''
	}
	/**
	 * Registers a route for any HTTP method.
	 *
	 * @param method - HTTP method (e.g. `'GET'`, `'POST'`).
	 * @param path - Route path, supports named params (e.g. `'/users/:id'`).
	 * @param handlers - One or more handlers; the first to return a non-`undefined` value short-circuits the rest.
	 *
	 * @example
	 * ```ts
	 * app.add('GET', '/ping', () => 'pong')
	 * ```
	 */
	add<Path extends string>(method: HTTPMethod, path: Path, ...handlers: [Handler<Path>, ...Handler<Path>[]]): this {
		this._router = null
		this.routes.push({
			method,
			path: this.basePath + path,
			handlers: handlers as AnyHandler[],
			instanceMiddlewares: []
		})
		return this
	}
	/**
	 * Registers a `GET` route.
	 *
	 * Passing a plain string as the first handler registers a static response body.
	 *
	 * @param path - Route path.
	 * @param handlers - One or more handlers, or a static string body.
	 *
	 * @example
	 * ```ts
	 * app.get('/ping', 'pong')
	 * app.get('/users/:id', (ctx) => findUser(ctx.params.get('id')))
	 * ```
	 */
	get<Path extends string>(path: Path, ...handlers: [string | Handler<Path>, ...Handler<Path>[]]): this {
		if (typeof handlers[0] === 'string') {
			const staticBody = handlers[0]
			return this.add('GET', path, () => staticBody)
		}
		return this.add('GET', path, ...(handlers as [Handler<Path>, ...Handler<Path>[]]))
	}
	/**
	 * Registers a `POST` route.
	 *
	 * @param path - Route path.
	 * @param handlers - One or more route handlers.
	 *
	 * @example
	 * ```ts
	 * app.post('/users', (ctx) => createUser(ctx.body))
	 * ```
	 */
	post<Path extends string>(path: Path, ...handlers: [Handler<Path>, ...Handler<Path>[]]): this {
		return this.add('POST', path, ...handlers)
	}
	/**
	 * Registers a `PUT` route.
	 *
	 * @param path - Route path.
	 * @param handlers - One or more route handlers.
	 *
	 * @example
	 * ```ts
	 * app.put('/users/:id', (ctx) => replaceUser(ctx.params.get('id'), ctx.body))
	 * ```
	 */
	put<Path extends string>(path: Path, ...handlers: [Handler<Path>, ...Handler<Path>[]]): this {
		return this.add('PUT', path, ...handlers)
	}
	/**
	 * Registers a `PATCH` route.
	 *
	 * @param path - Route path.
	 * @param handlers - One or more route handlers.
	 *
	 * @example
	 * ```ts
	 * app.patch('/users/:id', (ctx) => updateUser(ctx.params.get('id'), ctx.body))
	 * ```
	 */
	patch<Path extends string>(path: Path, ...handlers: [Handler<Path>, ...Handler<Path>[]]): this {
		return this.add('PATCH', path, ...handlers)
	}
	/**
	 * Registers a `DELETE` route.
	 *
	 * @param path - Route path.
	 * @param handlers - One or more route handlers.
	 *
	 * @example
	 * ```ts
	 * app.delete('/users/:id', (ctx) => deleteUser(ctx.params.get('id')))
	 * ```
	 */
	delete<Path extends string>(path: Path, ...handlers: [Handler<Path>, ...Handler<Path>[]]): this {
		return this.add('DELETE', path, ...handlers)
	}
	/**
	 * Registers a `HEAD` route.
	 *
	 * @param path - Route path.
	 * @param handlers - One or more route handlers.
	 */
	head<Path extends string>(path: Path, ...handlers: [Handler<Path>, ...Handler<Path>[]]): this {
		return this.add('HEAD', path, ...handlers)
	}
	/**
	 * Registers an `OPTIONS` route.
	 *
	 * @param path - Route path.
	 * @param handlers - One or more route handlers.
	 */
	options<Path extends string>(path: Path, ...handlers: [Handler<Path>, ...Handler<Path>[]]): this {
		return this.add('OPTIONS', path, ...handlers)
	}
	/**
	 * Mounts a sub-application, keeping its middleware scoped to its own routes.
	 *
	 * @param app - Sub-application to mount.
	 *
	 * @example
	 * ```ts
	 * const users = new Artesia({ basePath: '/users' })
	 * users.use(requireAuth).get('/', listUsers)
	 *
	 * app.use(users) // requireAuth only runs for /users routes
	 * ```
	 */
	use(app: Artesia): this
	/**
	 * Adds a middleware to the global chain; runs for every route on this instance.
	 *
	 * Call `next()` to continue. Return a value without calling `next()` to short-circuit.
	 *
	 * @param middleware - Middleware function to add.
	 *
	 * @example
	 * ```ts
	 * app.use(async (ctx, next) => {
	 *   console.log(ctx.method, ctx.pathname)
	 *   await next()
	 * })
	 * ```
	 */
	use(middleware: Middleware): this
	use(middlewareOrApp: Middleware | Artesia): this {
		if (middlewareOrApp instanceof Artesia) {
			return this.merge(middlewareOrApp)
		}
		this.middlewares.push(middlewareOrApp)
		return this
	}
	/**
	 * Merges a sub-application's routes into this instance, scoping its middleware.
	 *
	 * Prefer `.use(subApp)` for the same behaviour with a more ergonomic API.
	 *
	 * @param other - Sub-application to merge.
	 *
	 * @example
	 * ```ts
	 * const api = new Artesia({ basePath: '/api' })
	 * app.merge(api)
	 * ```
	 */
	merge(other: Artesia): this {
		this._router = null
		const subMiddlewares = [...other.middlewares]
		for (const route of other.routes) {
			this.routes.push({
				...route,
				path: this.basePath + route.path,
				instanceMiddlewares: [...subMiddlewares, ...route.instanceMiddlewares]
			})
		}
		return this
	}
	private buildRouter(): Instance<Router.HTTPVersion.V1> {
		const router = Router({})
		for (const route of this.routes) {
			const stub = (() => {}) as unknown as RouteStub
			stub.__handlers = route.handlers
			stub.__instanceMiddlewares = route.instanceMiddlewares
			router.on(route.method, route.path, stub as unknown as Router.Handler<Router.HTTPVersion.V1>)
		}
		return router
	}
	private getRouter(): Instance<Router.HTTPVersion.V1> {
		this._router ??= this.buildRouter()
		return this._router
	}
	private async handleRequest(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
		const router = this.getRouter()
		const rawUrl = req.url ?? '/'
		const qIdx = rawUrl.indexOf('?')
		const pathname = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl
		const method = (req.method ?? 'GET').toUpperCase() as HTTPMethod
		const match = router.find(method, pathname)
		if (!match) {
			res.statusCode = 404
			res.setHeader('content-type', 'application/json; charset=utf-8')
			const buf = Buffer.from(JSON.stringify({ error: 'Not Found', path: pathname }), 'utf8')
			res.setHeader('content-length', buf.byteLength)
			res.end(buf)
			return
		}
		const stub = match.handler as unknown as RouteStub
		const handlers: AnyHandler[] = stub.__handlers
		const routeMiddlewares: Middleware[] = stub.__instanceMiddlewares
		const rawParams = (match.params ?? {}) as Record<string, string>
		const store = new Map<string, unknown>()
		const rawCookies = parseCookie(req.headers.cookie ?? '')
		const cookies: Record<string, string> = Object.fromEntries(Object.entries(rawCookies).filter((e): e is [string, string] => e[1] !== undefined))
		const { body, rawBody, files } = await parseBody(req)
		const ctx = buildContext({
			req,
			method,
			pathname,
			params: rawParams,
			body,
			rawBody,
			files,
			store,
			cookies
		})
		let handlerResult: unknown
		let handlerIdx = 0
		const mws = [...this.middlewares, ...routeMiddlewares]
		const run = async (mwIdx: number): Promise<void> => {
			if (mwIdx < mws.length) {
				const mw = mws[mwIdx]
				if (!mw) return
				let nextCalled = false
				const result = await mw(ctx, async () => {
					nextCalled = true
					await run(mwIdx + 1)
				})
				if (!nextCalled && result !== undefined) {
					handlerResult = result
				}
				return
			}
			while (handlerIdx < handlers.length) {
				const handler = handlers[handlerIdx++]
				if (!handler) continue
				const result = await handler(ctx as Context<string>)
				if (result !== undefined) {
					handlerResult = result
					return
				}
			}
		}
		await run(0)
		const { headers, status } = getResponseMeta(ctx)
		sendValue(res, handlerResult, headers, status.value)
	}
	/**
	 * Starts an HTTP server.
	 *
	 * Resolves with the bound port and the underlying `Server` instance.
	 * Defaults to a random available port when `port` is omitted.
	 *
	 * @param port - Port to listen on (default: random).
	 * @param hostname - Hostname to bind to (default: `'0.0.0.0'`).
	 *
	 * @example
	 * ```ts
	 * const { port } = await app.listen(3000)
	 * console.log(`Listening on port ${port}`)
	 * ```
	 */
	listen(port?: number, hostname?: string): Promise<{ port: number; server: Server }> {
		return new Promise((resolve, reject) => {
			const server = createServer((req, res) => {
				this.handleRequest(req, res).catch((err: unknown) => {
					if (!res.headersSent) {
						res.statusCode = 500
						res.setHeader('content-type', 'application/json; charset=utf-8')
						const message = err instanceof Error ? err.message : 'Internal Server Error'
						const buf = Buffer.from(JSON.stringify({ error: message }), 'utf8')
						res.setHeader('content-length', buf.byteLength)
						res.end(buf)
					}
				})
			})
			server.on('error', reject)
			server.listen(port, hostname, () => {
				const addr = server.address()
				const actualPort = addr && typeof addr === 'object' ? addr.port : (port ?? 0)
				process.env.NODE_ENV !== 'production' && console.log(`\n  Server listening on http://localhost:${actualPort}\n`)
				resolve({ port: actualPort, server })
			})
		})
	}
	/**
	 * Returns the raw request handler for use with an existing HTTP server
	 * or testing utilities.
	 *
	 * @example
	 * ```ts
	 * const server = http.createServer(app.handler)
	 * ```
	 */
	get handler(): (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void> {
		return this.handleRequest.bind(this)
	}
}

/**
 * Creates a new `Artesia` application instance.
 *
 * @param options.basePath - Optional path prefix applied to every route.
 *
 * @example
 * ```ts
 * const app = artesia()
 * app.get('/ping', () => 'pong').listen(3000)
 * ```
 */
export function artesia(options?: ArtesiaOptions): Artesia {
	return new Artesia(options)
}
