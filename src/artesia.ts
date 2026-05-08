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

type RouteStub = { (): void; __handlers: AnyHandler[] }

export class Artesia {
	private readonly basePath: string
	private readonly middlewares: Middleware[] = []
	private readonly routes: RouteDefinition[] = []
	private _router: Instance<Router.HTTPVersion.V1> | null = null
	constructor(options: ArtesiaOptions = {}) {
		this.basePath = options.basePath?.replace(/\/+$/, '') ?? ''
	}
	add<Path extends string>(method: HTTPMethod, path: Path, ...handlers: [Handler<Path>, ...Handler<Path>[]]): this {
		this._router = null
		this.routes.push({
			method,
			path: this.basePath + path,
			handlers: handlers as AnyHandler[]
		})
		return this
	}
	get<Path extends string>(path: Path, ...handlers: [string | Handler<Path>, ...Handler<Path>[]]): this {
		if (typeof handlers[0] === 'string') {
			const staticBody = handlers[0]
			return this.add('GET', path, () => staticBody)
		}
		return this.add('GET', path, ...(handlers as [Handler<Path>, ...Handler<Path>[]]))
	}
	post<Path extends string>(path: Path, ...handlers: [Handler<Path>, ...Handler<Path>[]]): this {
		return this.add('POST', path, ...handlers)
	}
	put<Path extends string>(path: Path, ...handlers: [Handler<Path>, ...Handler<Path>[]]): this {
		return this.add('PUT', path, ...handlers)
	}
	patch<Path extends string>(path: Path, ...handlers: [Handler<Path>, ...Handler<Path>[]]): this {
		return this.add('PATCH', path, ...handlers)
	}
	delete<Path extends string>(path: Path, ...handlers: [Handler<Path>, ...Handler<Path>[]]): this {
		return this.add('DELETE', path, ...handlers)
	}
	head<Path extends string>(path: Path, ...handlers: [Handler<Path>, ...Handler<Path>[]]): this {
		return this.add('HEAD', path, ...handlers)
	}
	options<Path extends string>(path: Path, ...handlers: [Handler<Path>, ...Handler<Path>[]]): this {
		return this.add('OPTIONS', path, ...handlers)
	}
	use(middleware: Middleware): this {
		this.middlewares.push(middleware)
		return this
	}
	merge(other: Artesia): this {
		this._router = null
		for (const mw of other.middlewares) {
			this.middlewares.push(mw)
		}
		for (const route of other.routes) {
			this.routes.push({
				...route,
				path: this.basePath + route.path
			})
		}
		return this
	}
	private buildRouter(): Instance<Router.HTTPVersion.V1> {
		const router = Router({})
		for (const route of this.routes) {
			const stub = (() => {}) as unknown as RouteStub
			stub.__handlers = route.handlers
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
		const mws = this.middlewares
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
			server.listen(port ?? 0, hostname ?? '0.0.0.0', () => {
				const addr = server.address()
				const actualPort = addr && typeof addr === 'object' ? addr.port : (port ?? 0)
				resolve({ port: actualPort, server })
			})
		})
	}
	get handler(): (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void> {
		return this.handleRequest.bind(this)
	}
}

export function artesia(options?: ArtesiaOptions): Artesia {
	return new Artesia(options)
}
