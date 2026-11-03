import { createServer, type Server } from 'node:http'
import { parse as parseCookie } from 'cookie'
import type { HTTPMethod, Instance } from 'find-my-way'
import Router from 'find-my-way'
import { parseBody } from './body-parser'
import { buildContext, getResponseMeta } from './context'
import { sendValue } from './response'
import type { ArtesiaOptions, Context, ErrorHandler, Handler, Middleware, NotFoundHandler, RouteDefinition } from './types'
import { isArtesiaResponse } from './types'

export type { HTTPMethod }

type AnyHandler = Handler<string>

type RouteStub = { (): void; __handlers: AnyHandler[]; __instanceMiddlewares: Middleware[] }

/**
 * The core Artesia application class.
 *
 * @example
 * ```ts
 * const app = Artesia({ basePath: '/api' })
 * app.use(logger()).get('/users', getUsers).listen(3000)
 * ```
 */
class ArtesiaCore {
	private readonly basePath: string
	private readonly poweredBy: string | null = 'Artesia'
	private readonly maxBodySize?: number
	private readonly middlewares: Middleware[] = []
	private readonly routes: RouteDefinition[] = []
	private readonly subApps: Array<{ prefix: string; app: ArtesiaCore }> = []
	private customErrorHandler: ErrorHandler | null = null
	private customNotFoundHandler: NotFoundHandler | null = null
	private server: Server | null = null
	private _router: Instance<Router.HTTPVersion.V1> | null = null

	/**
	 * @param options.basePath - Optional path prefix applied to every route on this instance.
	 * @param options.poweredBy - Value for `X-Powered-By` header (default: `'Artesia'`, `false` to disable).
	 * @param options.maxBodySize - Maximum request body size in bytes (default: 10MB).
	 */
	constructor(options: ArtesiaOptions = {}) {
		this.basePath = options.basePath ? this.normalizeBasePath(options.basePath) : ''
		if (options.poweredBy === false) {
			this.poweredBy = null
		} else if (typeof options.poweredBy === 'string') {
			this.poweredBy = options.poweredBy
		} else {
			this.poweredBy = 'Artesia'
		}
		this.maxBodySize = options.maxBodySize
	}

	private normalizeBasePath(bp: string): string {
		const trimmed = bp.replace(/\/+$/, '')
		if (!trimmed) return ''
		return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
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
		const cleanPath = path.startsWith('/') ? path : `/${path}`
		const fullPath = (this.basePath + cleanPath).replace(/\/+/g, '/') || '/'
		this.routes.push({
			method,
			path: fullPath,
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
	 * const users = Artesia({ basePath: '/users' })
	 * users.use(requireAuth).get('/', listUsers)
	 *
	 * app.use(users) // requireAuth only runs for /users routes
	 * ```
	 */
	use(app: Artesia): this
	/**
	 * Mounts a sub-application under an explicit path prefix.
	 *
	 * @param prefix - Path prefix for the mounted sub-application.
	 * @param app - Sub-application to mount.
	 */
	use(prefix: string, app: Artesia): this
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
	/**
	 * Adds a middleware scoped to routes matching a specific path prefix.
	 *
	 * @param prefix - Path prefix to scope the middleware to.
	 * @param middleware - Middleware function to run.
	 */
	use(prefix: string, middleware: Middleware): this
	use(prefixOrMiddlewareOrApp: string | Middleware | Artesia, maybeMiddlewareOrApp?: Middleware | Artesia): this {
		this._router = null
		if (typeof prefixOrMiddlewareOrApp === 'string') {
			const prefix = prefixOrMiddlewareOrApp
			const target = maybeMiddlewareOrApp
			if (!target) return this
			if (target instanceof ArtesiaCore || (typeof target === 'object' && target !== null && 'routes' in target && 'middlewares' in target)) {
				return this.merge(target as unknown as Artesia, prefix)
			}
			if (typeof target === 'function') {
				const cleanPrefix = this.normalizeBasePath(prefix)
				const scopedMw: Middleware = (ctx, next) => {
					if (ctx.pathname === cleanPrefix || ctx.pathname.startsWith(`${cleanPrefix}/`)) {
						Object.defineProperty(ctx, '__mountPrefix', { value: cleanPrefix, configurable: true })
						return target(ctx, next)
					}
					return next()
				}
				this.middlewares.push(scopedMw)
				return this
			}
			return this
		}
		const target = prefixOrMiddlewareOrApp
		if (target instanceof ArtesiaCore || (typeof target === 'object' && target !== null && 'routes' in target && 'middlewares' in target)) {
			return this.merge(target as unknown as Artesia)
		}
		if (typeof target === 'function') {
			this.middlewares.push(target)
		}
		return this
	}

	/**
	 * Merges a sub-application's routes into this instance, scoping its middleware.
	 *
	 * Prefer `.use(subApp)` for the same behaviour with a more ergonomic API.
	 *
	 * @param other - Sub-application to merge.
	 * @param prefix - Optional path prefix to prepend to the sub-app's routes.
	 *
	 * @example
	 * ```ts
	 * const api = Artesia({ basePath: '/api' })
	 * app.merge(api)
	 * ```
	 */
	merge(other: Artesia, prefix = ''): this {
		this._router = null
		const pfx = prefix ? this.normalizeBasePath(prefix) : ''
		const targetCore = other as unknown as ArtesiaCore
		this.subApps.push({ prefix: pfx, app: targetCore })
		return this
	}

	/**
	 * Creates a grouped route scope with an optional prefix.
	 *
	 * @example
	 * ```ts
	 * app.group('/v1', (v1) => {
	 *   v1.get('/users', getUsers)
	 * })
	 * ```
	 */
	group(prefix: string, fn: (group: Artesia) => void): this {
		const sub = new Artesia()
		fn(sub)
		this.use(prefix, sub)
		return this
	}

	/**
	 * Registers a custom error handler for uncaught exceptions.
	 *
	 * @example
	 * ```ts
	 * app.onError((err, ctx) => {
	 *   ctx.set.status(500)
	 *   return { error: err.message }
	 * })
	 * ```
	 */
	onError(handler: ErrorHandler): this {
		this.customErrorHandler = handler
		return this
	}

	/**
	 * Registers a custom 404 Not Found handler.
	 *
	 * @example
	 * ```ts
	 * app.notFound((ctx) => {
	 *   return ctx.html('<h1>Page Not Found</h1>', 404)
	 * })
	 * ```
	 */
	notFound(handler: NotFoundHandler): this {
		this.customNotFoundHandler = handler
		return this
	}

	/**
	 * Closes the underlying HTTP server.
	 */
	close(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.server) return resolve()
			this.server.close(err => (err ? reject(err) : resolve()))
		})
	}

	private collectAllRoutes(): RouteDefinition[] {
		const allRoutes: RouteDefinition[] = [...this.routes]
		for (const { prefix, app } of this.subApps) {
			const subRoutes = app.collectAllRoutes()
			const subMiddlewares = [...app.middlewares]
			for (const r of subRoutes) {
				const combinedPath = (this.basePath + prefix + r.path).replace(/\/+/g, '/') || '/'
				allRoutes.push({
					...r,
					path: combinedPath,
					instanceMiddlewares: [...subMiddlewares, ...r.instanceMiddlewares]
				})
			}
		}
		return allRoutes
	}

	private buildRouter(): Instance<Router.HTTPVersion.V1> {
		const router = Router({ ignoreTrailingSlash: true })
		const allRoutes = this.collectAllRoutes()
		for (const route of allRoutes) {
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
		try {
			const router = this.getRouter()
			const rawUrl = req.url ?? '/'
			const qIdx = rawUrl.indexOf('?')
			const pathname = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl
			const method = (req.method ?? 'GET').toUpperCase() as HTTPMethod
			const match = router.find(method, pathname)

			const rawParams = (match?.params ?? {}) as Record<string, string>
			const handlers: AnyHandler[] = match ? (match.handler as unknown as RouteStub).__handlers : []
			const routeMiddlewares: Middleware[] = match ? (match.handler as unknown as RouteStub).__instanceMiddlewares : []

			const store = new Map<string, unknown>()
			const rawCookies = parseCookie(req.headers.cookie ?? '')
			const cookies: Record<string, string> = Object.create(null)
			for (const [k, v] of Object.entries(rawCookies)) {
				if (v !== undefined) cookies[k] = v
			}

			const { body, rawBody, files } = await parseBody(req, this.maxBodySize)
			const ctx = buildContext({
				req,
				method,
				pathname,
				params: rawParams,
				body,
				rawBody,
				files,
				store,
				cookies,
				poweredBy: this.poweredBy
			})

			let handlerResult: unknown
			let handlerIdx = 0
			const mws = [...this.middlewares, ...routeMiddlewares]

			const updateMeta = (result: unknown) => {
				const { status } = getResponseMeta(ctx)
				if (isArtesiaResponse(result)) {
					if (result.status !== 200) {
						status.value = result.status
					}
				} else if (result === null || result === undefined) {
					if (status.value === 200) {
						status.value = 204
					}
				}

				let cl: string | null = null
				if (isArtesiaResponse(result)) {
					cl = (result.headers.get('content-length') as string) ?? null
					if (cl === null && result.body !== null) {
						cl = String(Buffer.isBuffer(result.body) ? result.body.byteLength : Buffer.byteLength(result.body, 'utf8'))
					}
				} else if (result === null || result === undefined) {
					cl = '0'
				} else if (Buffer.isBuffer(result)) {
					cl = String(result.byteLength)
				} else if (typeof result === 'string') {
					cl = String(Buffer.byteLength(result, 'utf8'))
				} else {
					try {
						cl = String(Buffer.byteLength(JSON.stringify(result), 'utf8'))
					} catch {
						cl = null
					}
				}
				Object.defineProperty(ctx, '__responseContentLength', { value: cl, writable: true, enumerable: false })
			}

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
						updateMeta(handlerResult)
					}
					return
				}

				if (!match) {
					ctx.set.status(404)
					if (this.customNotFoundHandler) {
						const nfResult = await this.customNotFoundHandler(ctx)
						if (nfResult !== undefined) {
							handlerResult = nfResult
							updateMeta(handlerResult)
							return
						}
					}
					handlerResult = { error: 'Not Found', path: pathname }
					updateMeta(handlerResult)
					return
				}

				while (handlerIdx < handlers.length) {
					const handler = handlers[handlerIdx++]
					if (!handler) continue
					const result = await handler(ctx as Context<string>)
					if (result !== undefined) {
						handlerResult = result
						break
					}
				}
				updateMeta(handlerResult)
			}

			try {
				await run(0)
			} catch (err: unknown) {
				if (this.customErrorHandler) {
					const errorObj = err instanceof Error ? err : new Error(String(err))
					if (getResponseMeta(ctx).status.value === 200) {
						ctx.set.status(500)
					}
					const errResult = await this.customErrorHandler(errorObj, ctx)
					if (errResult !== undefined) {
						handlerResult = errResult
						updateMeta(handlerResult)
					} else {
						throw err
					}
				} else {
					throw err
				}
			}

			const { headers, status } = getResponseMeta(ctx)
			sendValue(res, handlerResult, headers, status.value)
		} catch (err: unknown) {
			if (!res.headersSent) {
				const is413 = (err as unknown as { status?: number })?.status === 413 || (err instanceof Error && err.message === 'Payload Too Large')
				res.statusCode = is413 ? 413 : 500
				if (this.poweredBy) {
					res.setHeader('x-powered-by', this.poweredBy)
				}
				res.setHeader('content-type', 'application/json; charset=utf-8')
				const message = err instanceof Error ? err.message : 'Internal Server Error'
				const buf = Buffer.from(JSON.stringify({ error: message }), 'utf8')
				res.setHeader('content-length', buf.byteLength)
				res.end(buf)
			}
		}
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
			this.server = server
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

export interface Artesia extends ArtesiaCore {}

export interface ArtesiaConstructor {
	new (options?: ArtesiaOptions): Artesia
	(options?: ArtesiaOptions): Artesia
}

export const Artesia: ArtesiaConstructor = new Proxy(ArtesiaCore, {
	apply(_target, _thisArg, args) {
		return new ArtesiaCore(...(args as [ArtesiaOptions?]))
	}
}) as unknown as ArtesiaConstructor

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
export const artesia: ArtesiaConstructor = Artesia
