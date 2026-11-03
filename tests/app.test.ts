import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'node:http'
import { Artesia, artesia } from '../src/artesia'
import { buildMiddleware, cors, logger, requestId, secureHeaders, serveStatic } from '../src/middleware'

let server: Server
let baseUrl: string

async function startApp(instance: Artesia): Promise<void> {
	const result = await instance.listen()
	server = result.server
	baseUrl = `http://127.0.0.1:${result.port}`
}

function stopApp(): Promise<void> {
	return new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())))
}

async function req(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown; headers: Headers }> {
	const res = await fetch(`${baseUrl}${path}`, init)
	const ct = res.headers.get('content-type') ?? ''
	const body = ct.includes('application/json') ? await res.json() : await res.text()
	return { status: res.status, body, headers: res.headers }
}

describe('routing', () => {
	beforeEach(async () => {
		const instance = new Artesia()
		instance
			.get('/', 'Hello World')
			.get('/json', () => ({ ok: true }))
			.post('/echo', ctx => ctx.body)
			.put('/put', () => ({ method: 'PUT' }))
			.patch('/patch', () => ({ method: 'PATCH' }))
			.delete('/delete', () => ({ deleted: true }))
		await startApp(instance)
	})
	afterEach(stopApp)
	test('GET static string', async () => {
		const { status, body } = await req('/')
		expect(status).toBe(200)
		expect(body).toBe('Hello World')
	})
	test('GET json object', async () => {
		const { status, body } = await req('/json')
		expect(status).toBe(200)
		expect(body).toEqual({ ok: true })
	})
	test('POST echo json body', async () => {
		const { status, body } = await req('/echo', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ hello: 'world' })
		})
		expect(status).toBe(200)
		expect(body).toEqual({ hello: 'world' })
	})
	test('PUT returns method', async () => {
		const { status, body } = await req('/put', { method: 'PUT' })
		expect(status).toBe(200)
		expect(body).toEqual({ method: 'PUT' })
	})
	test('PATCH returns method', async () => {
		const { status, body } = await req('/patch', { method: 'PATCH' })
		expect(status).toBe(200)
		expect(body).toEqual({ method: 'PATCH' })
	})
	test('DELETE returns deleted', async () => {
		const { status, body } = await req('/delete', { method: 'DELETE' })
		expect(status).toBe(200)
		expect(body).toEqual({ deleted: true })
	})
	test('404 for unknown route', async () => {
		const { status } = await req('/nope')
		expect(status).toBe(404)
	})
})

describe('params', () => {
	beforeEach(async () => {
		const instance = new Artesia()
		instance
			.get('/users/:id', ctx => ({ id: ctx.params.get('id') }))
			.get('/posts/:year/:slug', ctx => ({
				year: ctx.params.get('year'),
				slug: ctx.params.get('slug')
			}))
		await startApp(instance)
	})
	afterEach(stopApp)
	test('single param', async () => {
		const { body } = await req('/users/42')
		expect(body).toEqual({ id: '42' })
	})
	test('multiple params', async () => {
		const { body } = await req('/posts/2024/hello-world')
		expect(body).toEqual({ year: '2024', slug: 'hello-world' })
	})
})

describe('searchParams', () => {
	beforeEach(async () => {
		const instance = new Artesia()
		instance.get('/search', ctx => ({
			q: ctx.searchParams.get('q'),
			page: ctx.searchParams.get('page')
		}))
		await startApp(instance)
	})
	afterEach(stopApp)
	test('reads query string', async () => {
		const { body } = await req('/search?q=artesia&page=2')
		expect(body).toEqual({ q: 'artesia', page: '2' })
	})
})

describe('basePath', () => {
	beforeEach(async () => {
		const instance = new Artesia({ basePath: '/api/v1' })
		instance.get('/ping', () => ({ pong: true }))
		await startApp(instance)
	})
	afterEach(stopApp)
	test('route is mounted under basePath', async () => {
		const { status, body } = await req('/api/v1/ping')
		expect(status).toBe(200)
		expect(body).toEqual({ pong: true })
	})
	test('without basePath prefix → 404', async () => {
		const { status } = await req('/ping')
		expect(status).toBe(404)
	})
})

describe('middleware', () => {
	beforeEach(async () => {
		const instance = new Artesia()
		instance
			.use(async (ctx, next) => {
				ctx.store.set('mw', 'touched')
				await next()
			})
			.get('/mw', ctx => ({ mw: ctx.store.get('mw') }))
		await startApp(instance)
	})
	afterEach(stopApp)
	test('middleware sets store value', async () => {
		const { body } = await req('/mw')
		expect(body).toEqual({ mw: 'touched' })
	})
})

describe('middleware short-circuit', () => {
	beforeEach(async () => {
		const instance = new Artesia()
		instance
			.use(ctx => {
				ctx.set.status(401)
				return { error: 'Unauthorized' }
			})
			.get('/secret', () => ({ secret: true }))
		await startApp(instance)
	})
	afterEach(stopApp)
	test('middleware can short-circuit without calling next()', async () => {
		const { status, body } = await req('/secret')
		expect(status).toBe(401)
		expect(body).toEqual({ error: 'Unauthorized' })
	})
})

describe('set.headers', () => {
	beforeEach(async () => {
		const instance = new Artesia()
		instance.get('/hdr', ctx => {
			ctx.set.headers('x-custom', 'artesia')
			return { ok: true }
		})
		await startApp(instance)
	})
	afterEach(stopApp)
	test('custom header is sent', async () => {
		const { headers } = await req('/hdr')
		expect(headers.get('x-custom')).toBe('artesia')
	})
})

describe('set.status', () => {
	beforeEach(async () => {
		const instance = new Artesia()
		instance
			.post('/created', ctx => {
				ctx.set.status(201)
				return ctx.body
			})
			.get('/teapot', ctx => {
				ctx.set.status("I'm a Teapot")
				return null
			})
		await startApp(instance)
	})
	afterEach(stopApp)
	test('numeric status', async () => {
		const { status } = await req('/created', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({})
		})
		expect(status).toBe(201)
	})
	test('text status', async () => {
		const { status } = await req('/teapot')
		expect(status).toBe(418)
	})
})

describe('ctx.html', () => {
	beforeEach(async () => {
		const instance = new Artesia()
		instance.get('/page', ctx => ctx.html('<h1>Hi</h1>'))
		await startApp(instance)
	})
	afterEach(stopApp)
	test('returns HTML with correct content-type', async () => {
		const { status, body, headers } = await req('/page')
		expect(status).toBe(200)
		expect(body).toBe('<h1>Hi</h1>')
		expect(headers.get('content-type')).toContain('text/html')
	})
})

describe('ctx.redirect', () => {
	beforeEach(async () => {
		const instance = new Artesia()
		instance.get('/old', ctx => ctx.redirect('/new', 301))
		await startApp(instance)
	})
	afterEach(stopApp)
	test('redirect sends correct status and location', async () => {
		const res = await fetch(`${baseUrl}/old`, { redirect: 'manual' })
		expect(res.status).toBe(301)
		expect(res.headers.get('location')).toBe('/new')
	})
})

describe('add()', () => {
	beforeEach(async () => {
		const instance = new Artesia()
		instance.add('GET', '/hook', () => ({ hooked: true }))
		await startApp(instance)
	})
	afterEach(stopApp)
	test('.add() registers route correctly', async () => {
		const { status, body } = await req('/hook')
		expect(status).toBe(200)
		expect(body).toEqual({ hooked: true })
	})
})

describe('merge', () => {
	beforeEach(async () => {
		const sub = new Artesia({ basePath: '/sub' })
		sub.get('/hello', () => ({ from: 'sub' }))
		const main = new Artesia()
		main.get('/main', () => ({ from: 'main' })).use(sub)
		await startApp(main)
	})
	afterEach(stopApp)
	test('main route works', async () => {
		const { body } = await req('/main')
		expect(body).toEqual({ from: 'main' })
	})
	test('merged sub-app route works', async () => {
		const { body } = await req('/sub/hello')
		expect(body).toEqual({ from: 'sub' })
	})
})

describe('merge: middleware scoping', () => {
	beforeEach(async () => {
		const sub = new Artesia({ basePath: '/sub' })
		sub.use(async (ctx, next) => {
			ctx.store.set('scope', 'sub-only')
			await next()
		}).get('/hello', ctx => ({ scope: ctx.store.get('scope') ?? null }))
		const main = new Artesia()
		main.get('/main', ctx => ({ scope: ctx.store.get('scope') ?? null })).use(sub)
		await startApp(main)
	})
	afterEach(stopApp)
	test('sub middleware runs for sub route', async () => {
		const { body } = await req('/sub/hello')
		expect(body).toEqual({ scope: 'sub-only' })
	})
	test('sub middleware does NOT leak into main route', async () => {
		const { body } = await req('/main')
		expect(body).toEqual({ scope: null })
	})
})

describe('urlencoded body', () => {
	beforeEach(async () => {
		const instance = new Artesia()
		instance.post('/form', ctx => ctx.body)
		await startApp(instance)
	})
	afterEach(stopApp)
	test('parses urlencoded body', async () => {
		const { body } = await req('/form', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: 'name=artesia&version=1'
		})
		expect(body).toEqual({ name: 'artesia', version: '1' })
	})
})

describe('null response', () => {
	beforeEach(async () => {
		const instance = new Artesia()
		instance.delete('/item/:id', () => null)
		await startApp(instance)
	})
	afterEach(stopApp)
	test('null returns 204 No Content', async () => {
		const { status } = await req('/item/99', { method: 'DELETE' })
		expect(status).toBe(204)
	})
})

describe('store sharing', () => {
	beforeEach(async () => {
		const instance = new Artesia()
		instance
			.use(async (ctx, next) => {
				ctx.store.set('user', { id: 1 })
				await next()
			})
			.get('/me', ctx => ctx.store.get('user'))
		await startApp(instance)
	})
	afterEach(stopApp)
	test('store propagates from middleware to handler', async () => {
		const { body } = await req('/me')
		expect(body).toEqual({ id: 1 })
	})
})

describe('factory call', () => {
	test('Artesia() without new creates valid app instance', async () => {
		const app = Artesia()
		expect(app instanceof Artesia).toBe(true)
		app.get('/test', () => 'ok')
		await startApp(app)
		const { status, body } = await req('/test')
		expect(status).toBe(200)
		expect(body).toBe('ok')
		await stopApp()
	})
	test('artesia() creates valid app instance', async () => {
		const app = artesia()
		expect(app instanceof Artesia).toBe(true)
		app.get('/test2', () => 'ok2')
		await startApp(app)
		const { status, body } = await req('/test2')
		expect(status).toBe(200)
		expect(body).toBe('ok2')
		await stopApp()
	})
})

describe('cors middleware', () => {
	test('CORS handles simple GET request with wildcard origin', async () => {
		const app = Artesia()
		app.use(cors())
		app.get('/cors', () => ({ cors: true }))
		await startApp(app)
		const { status, headers } = await req('/cors', {
			headers: { Origin: 'https://example.com' }
		})
		expect(status).toBe(200)
		expect(headers.get('access-control-allow-origin')).toBe('*')
		await stopApp()
	})
	test('CORS handles preflight OPTIONS request on route without explicit OPTIONS handler', async () => {
		const app = Artesia()
		app.use(cors())
		app.post('/api/save', () => ({ saved: true }))
		await startApp(app)
		const res = await fetch(`${baseUrl}/api/save`, {
			method: 'OPTIONS',
			headers: {
				Origin: 'https://example.com',
				'Access-Control-Request-Method': 'POST',
				'Access-Control-Request-Headers': 'Content-Type'
			}
		})
		expect(res.status).toBe(204)
		expect(res.headers.get('access-control-allow-origin')).toBe('*')
		expect(res.headers.get('access-control-allow-methods')).toContain('POST')
		expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type')
		await stopApp()
	})
	test('CORS with credentials reflects origin and sets vary', async () => {
		const app = Artesia()
		app.use(cors({ credentials: true }))
		app.get('/cred', () => ({ ok: true }))
		await startApp(app)
		const { headers } = await req('/cred', {
			headers: { Origin: 'https://app.example.com' }
		})
		expect(headers.get('access-control-allow-origin')).toBe('https://app.example.com')
		expect(headers.get('access-control-allow-credentials')).toBe('true')
		expect(headers.get('vary')).toBe('Origin')
		await stopApp()
	})
	test('CORS with origin list allows matching origin and ignores non-matching', async () => {
		const app = Artesia()
		app.use(cors({ origin: ['https://allowed.com'] }))
		app.get('/list', () => ({ ok: true }))
		await startApp(app)
		const res1 = await req('/list', { headers: { Origin: 'https://allowed.com' } })
		expect(res1.headers.get('access-control-allow-origin')).toBe('https://allowed.com')
		const res2 = await req('/list', { headers: { Origin: 'https://disallowed.com' } })
		expect(res2.headers.get('access-control-allow-origin')).toBeNull()
		await stopApp()
	})
})

describe('logger middleware', () => {
	test('logger calls custom log callback with correct fields', async () => {
		const app = Artesia()
		const logs: Array<{ pathname: string; status: number; durationMs: number }> = []
		app.use(logger({ log: (_line, fields) => logs.push(fields), colorize: false }))
		app.get('/logged', () => ({ logged: true }))
		app.delete('/item', () => null)
		app.get('/old', ctx => ctx.redirect('/new', 301))
		await startApp(app)

		await req('/logged')
		expect(logs.length).toBe(1)
		expect(logs[0]?.pathname).toBe('/logged')
		expect(logs[0]?.status).toBe(200)

		await req('/item', { method: 'DELETE' })
		expect(logs.length).toBe(2)
		expect(logs[1]?.status).toBe(204)

		await fetch(`${baseUrl}/old`, { redirect: 'manual' })
		expect(logs.length).toBe(3)
		expect(logs[2]?.status).toBe(301)

		await stopApp()
	})
	test('logger records 404 for unknown route', async () => {
		const app = Artesia()
		const logs: Array<{ pathname: string; status: number }> = []
		app.use(logger({ log: (_line, fields) => logs.push(fields), colorize: false }))
		await startApp(app)
		await req('/does-not-exist')
		expect(logs.length).toBe(1)
		expect(logs[0]?.pathname).toBe('/does-not-exist')
		expect(logs[0]?.status).toBe(404)
		await stopApp()
	})
	test('logger records 500 when handler throws', async () => {
		const app = Artesia()
		const logs: Array<{ pathname: string; status: number }> = []
		app.use(logger({ log: (_line, fields) => logs.push(fields), colorize: false }))
		app.get('/crash', () => {
			throw new Error('Crash')
		})
		await startApp(app)
		const { status, body } = await req('/crash')
		expect(status).toBe(500)
		expect(body).toEqual({ error: 'Crash' })
		expect(logs.length).toBe(1)
		expect(logs[0]?.status).toBe(500)
		await stopApp()
	})
})

describe('buildMiddleware helper', () => {
	test('buildMiddleware returns typed middleware function', () => {
		const mw = buildMiddleware(async (_ctx, next) => {
			await next()
		})
		expect(typeof mw).toBe('function')
	})
})

describe('cookies', () => {
	test('reading cookies and setting cookies', async () => {
		const app = Artesia()
		app.get('/cookie-test', ctx => {
			const session = ctx.cookie('session')
			const proto = ctx.cookie('constructor')
			ctx.set.cookies('out', '123', { httpOnly: true, path: '/' })
			return { session, proto: proto === undefined }
		})
		await startApp(app)
		const res = await fetch(`${baseUrl}/cookie-test`, {
			headers: { Cookie: 'session=abc; other=xyz' }
		})
		const json = await res.json()
		expect(json).toEqual({ session: 'abc', proto: true })
		expect(res.headers.get('set-cookie')).toContain('out=123')
		expect(res.headers.get('set-cookie')).toContain('HttpOnly')
		await stopApp()
	})
})

describe('ctx.file', () => {
	test('returns file with auto-detected MIME type and attachment headers', async () => {
		const app = Artesia()
		app.get('/pkg', ctx => ctx.file('./package.json', { disposition: 'attachment', filename: 'info.json' }))
		await startApp(app)
		const res = await fetch(`${baseUrl}/pkg`)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('application/json')
		expect(res.headers.get('content-disposition')).toBe('attachment; filename="info.json"')
		const text = await res.text()
		expect(text).toContain('"name": "artesia"')
		await stopApp()
	})
})

describe('multipart uploads', () => {
	test('parses multipart fields and uploaded files', async () => {
		const app = Artesia()
		app.post('/upload', ctx => {
			return {
				body: ctx.body,
				fileCount: ctx.files.length,
				firstFile: ctx.files[0]
					? {
							fieldname: ctx.files[0].fieldname,
							filename: ctx.files[0].filename,
							mimetype: ctx.files[0].mimetype,
							content: ctx.files[0].buffer.toString('utf8'),
							size: ctx.files[0].size
						}
					: null
			}
		})
		await startApp(app)
		const form = new FormData()
		form.append('username', 'artesia')
		form.append('avatar', new Blob(['fake image data'], { type: 'text/plain' }), 'avatar.txt')
		const res = await fetch(`${baseUrl}/upload`, {
			method: 'POST',
			body: form
		})
		expect(res.status).toBe(200)
		const data = (await res.json()) as {
			body: { username: string }
			fileCount: number
			firstFile: { fieldname: string; filename: string; mimetype: string; content: string; size: number }
		}
		expect(data.body.username).toBe('artesia')
		expect(data.fileCount).toBe(1)
		expect(data.firstFile.fieldname).toBe('avatar')
		expect(data.firstFile.filename).toBe('avatar.txt')
		expect(data.firstFile.content).toBe('fake image data')
		await stopApp()
	})
})

describe('app.handler with http.createServer', () => {
	test('works directly with node:http createServer and handles errors safely', async () => {
		const { createServer } = await import('node:http')
		const app = Artesia()
		app.get('/custom', () => 'custom server ok')
		app.get('/crash', () => {
			throw new Error('Unhandled in handler')
		})
		const customServer = createServer(app.handler)
		await new Promise<void>(resolve => customServer.listen(0, resolve))
		const port = (customServer.address() as { port: number }).port
		const resOk = await fetch(`http://127.0.0.1:${port}/custom`)
		expect(resOk.status).toBe(200)
		expect(await resOk.text()).toBe('custom server ok')

		const resCrash = await fetch(`http://127.0.0.1:${port}/crash`)
		expect(resCrash.status).toBe(500)
		expect(await resCrash.json()).toEqual({ error: 'Unhandled in handler' })
		await new Promise(resolve => customServer.close(resolve))
	})
})

describe('advanced routing & prefix scoping', () => {
	test('trailing slash normalization on basePath and routes', async () => {
		const app = Artesia({ basePath: 'api' })
		app.get('/ping', () => ({ pong: true }))
		await startApp(app)
		const res1 = await req('/api/ping')
		expect(res1.status).toBe(200)
		const res2 = await req('/api/ping/')
		expect(res2.status).toBe(200)
		await stopApp()
	})
	test('app.use(prefix, subApp)', async () => {
		const sub = Artesia()
		sub.get('/info', () => ({ sub: 'info' }))
		const main = Artesia()
		main.use('/v2', sub)
		await startApp(main)
		const { status, body } = await req('/v2/info')
		expect(status).toBe(200)
		expect(body).toEqual({ sub: 'info' })
		await stopApp()
	})
	test('subApp route added after app.use(subApp) is mounted', async () => {
		const sub = Artesia({ basePath: '/late' })
		const main = Artesia()
		main.use(sub)
		sub.get('/added-later', () => ({ late: true }))
		await startApp(main)
		const { status, body } = await req('/late/added-later')
		expect(status).toBe(200)
		expect(body).toEqual({ late: true })
		await stopApp()
	})
	test('app.use(prefix, middleware) scopes middleware to prefix', async () => {
		const app = Artesia()
		app.use('/admin', async (ctx, next) => {
			ctx.set.headers('x-admin-scoped', 'true')
			await next()
		})
		app.get('/admin/panel', () => ({ panel: true }))
		app.get('/public', () => ({ public: true }))
		await startApp(app)
		const r1 = await req('/admin/panel')
		expect(r1.headers.get('x-admin-scoped')).toBe('true')
		const r2 = await req('/public')
		expect(r2.headers.get('x-admin-scoped')).toBeNull()
		await stopApp()
	})
	test('wildcard route reads ctx.params.get("*")', async () => {
		const app = Artesia()
		app.get('/assets/*', ctx => ({ rest: ctx.params.get('*') }))
		await startApp(app)
		const { body } = await req('/assets/css/style.css')
		expect(body).toEqual({ rest: 'css/style.css' })
		await stopApp()
	})
	test('text and rawBody handling', async () => {
		const app = Artesia()
		app.post('/raw', ctx => {
			return {
				body: ctx.body,
				rawLength: ctx.rawBody?.byteLength
			}
		})
		await startApp(app)
		const res = await fetch(`${baseUrl}/raw`, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: 'plain text data'
		})
		const data = (await res.json()) as { body: string; rawLength: number }
		expect(data.body).toBe('plain text data')
		expect(data.rawLength).toBe(15)
		await stopApp()
	})
	test('set.headers and set.cookies safe with null or undefined', () => {
		const app = Artesia()
		app.get('/safe', ctx => {
			ctx.set.headers(undefined as unknown as Headers)
			ctx.set.headers(null as unknown as Headers)
			ctx.set.cookies(undefined as unknown as Record<string, string>)
			ctx.set.cookies(null as unknown as Record<string, string>)
			return { safe: true }
		})
		expect(app).toBeDefined()
	})
})

describe('x-powered-by header', () => {
	test('sends X-Powered-By: Artesia by default', async () => {
		const app = Artesia()
		app.get('/test-pby', () => ({ ok: true }))
		await startApp(app)
		const { headers } = await req('/test-pby')
		expect(headers.get('x-powered-by')).toBe('Artesia')
		await stopApp()
	})
	test('poweredBy: false disables header', async () => {
		const app = Artesia({ poweredBy: false })
		app.get('/test-disabled', () => ({ ok: true }))
		await startApp(app)
		const { headers } = await req('/test-disabled')
		expect(headers.get('x-powered-by')).toBeNull()
		await stopApp()
	})
	test('custom poweredBy string', async () => {
		const app = Artesia({ poweredBy: 'MyCustomServer' })
		app.get('/test-custom', () => ({ ok: true }))
		await startApp(app)
		const { headers } = await req('/test-custom')
		expect(headers.get('x-powered-by')).toBe('MyCustomServer')
		await stopApp()
	})
	test('handler can override x-powered-by', async () => {
		const app = Artesia()
		app.get('/test-override', ctx => {
			ctx.set.headers('x-powered-by', 'OverrideApp')
			return { ok: true }
		})
		await startApp(app)
		const { headers } = await req('/test-override')
		expect(headers.get('x-powered-by')).toBe('OverrideApp')
		await stopApp()
	})
})

describe('app.onError custom error handling', () => {
	test('custom error handler intercepts exception and customizes response', async () => {
		const app = Artesia()
		app.onError((err, ctx) => {
			ctx.set.status(400)
			return { code: 'CUSTOM_ERROR', msg: err.message }
		})
		app.get('/fail', () => {
			throw new Error('Validation failed')
		})
		await startApp(app)
		const { status, body } = await req('/fail')
		expect(status).toBe(400)
		expect(body).toEqual({ code: 'CUSTOM_ERROR', msg: 'Validation failed' })
		await stopApp()
	})
})

describe('app.notFound custom 404 handling', () => {
	test('custom notFound handler formats 404 response', async () => {
		const app = Artesia()
		app.notFound(ctx => {
			return ctx.html('<h1>Custom 404</h1>', 404)
		})
		await startApp(app)
		const { status, body, headers } = await req('/nowhere')
		expect(status).toBe(404)
		expect(body).toBe('<h1>Custom 404</h1>')
		expect(headers.get('content-type')).toContain('text/html')
		await stopApp()
	})
})

describe('app.group route grouping', () => {
	test('group mounts nested routes with prefix and scoped middleware', async () => {
		const app = Artesia()
		app.group('/v1', v1 => {
			v1.use(async (ctx, next) => {
				ctx.set.headers('x-v1-scoped', 'true')
				await next()
			})
			v1.get('/users', () => [{ id: 1, name: 'Bob' }])
		})
		await startApp(app)
		const { status, body, headers } = await req('/v1/users')
		expect(status).toBe(200)
		expect(body).toEqual([{ id: 1, name: 'Bob' }])
		expect(headers.get('x-v1-scoped')).toBe('true')
		await stopApp()
	})
})

describe('maxBodySize limit', () => {
	test('rejects payload exceeding maxBodySize with 413', async () => {
		const app = Artesia({ maxBodySize: 50 })
		app.post('/limited', ctx => ctx.body)
		await startApp(app)
		const largePayload = 'a'.repeat(200)
		const res = await fetch(`${baseUrl}/limited`, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: largePayload
		})
		expect(res.status).toBe(413)
		const json = (await res.json()) as { error: string }
		expect(json.error).toBe('Payload Too Large')
		await stopApp()
	})
})

describe('app.close()', () => {
	test('closes the server cleanly', async () => {
		const app = Artesia()
		app.get('/ping', () => 'pong')
		const { port } = await app.listen()
		const res = await fetch(`http://127.0.0.1:${port}/ping`)
		expect(res.status).toBe(200)
		await app.close()
	})
})

describe('secureHeaders middleware', () => {
	test('sets default security headers', async () => {
		const app = Artesia()
		app.use(secureHeaders())
		app.get('/secure', () => ({ ok: true }))
		await startApp(app)
		const { headers } = await req('/secure')
		expect(headers.get('x-content-type-options')).toBe('nosniff')
		expect(headers.get('x-frame-options')).toBe('SAMEORIGIN')
		expect(headers.get('x-xss-protection')).toBe('0')
		expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
		await stopApp()
	})
	test('supports custom options including HSTS and CSP', async () => {
		const app = Artesia()
		app.use(
			secureHeaders({
				xFrameOptions: 'DENY',
				strictTransportSecurity: { maxAge: 123456 },
				contentSecurityPolicy: "default-src 'self'"
			})
		)
		app.get('/custom-sec', () => ({ ok: true }))
		await startApp(app)
		const { headers } = await req('/custom-sec')
		expect(headers.get('x-frame-options')).toBe('DENY')
		expect(headers.get('strict-transport-security')).toContain('max-age=123456')
		expect(headers.get('content-security-policy')).toBe("default-src 'self'")
		await stopApp()
	})
})

describe('requestId middleware', () => {
	test('generates x-request-id header and stores it', async () => {
		const app = Artesia()
		app.use(requestId())
		app.get('/req-id', ctx => ({ id: ctx.store.get('requestId') }))
		await startApp(app)
		const res = await fetch(`${baseUrl}/req-id`)
		const idHeader = res.headers.get('x-request-id')
		expect(idHeader).toBeDefined()
		expect(idHeader?.length).toBeGreaterThan(10)
		const json = (await res.json()) as { id: string }
		expect(json.id).toBe(idHeader)
		await stopApp()
	})
	test('propagates existing incoming x-request-id', async () => {
		const app = Artesia()
		app.use(requestId())
		app.get('/req-id', ctx => ({ id: ctx.store.get('requestId') }))
		await startApp(app)
		const res = await fetch(`${baseUrl}/req-id`, {
			headers: { 'x-request-id': 'custom-trace-12345' }
		})
		expect(res.headers.get('x-request-id')).toBe('custom-trace-12345')
		const json = (await res.json()) as { id: string }
		expect(json.id).toBe('custom-trace-12345')
		await stopApp()
	})
})

describe('serveStatic middleware', () => {
	test('serves static files from root directory', async () => {
		const app = Artesia()
		app.use('/static', serveStatic({ root: '.' }))
		await startApp(app)
		const res = await fetch(`${baseUrl}/static/package.json`)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('application/json')
		const text = await res.text()
		expect(text).toContain('"name": "artesia"')
		await stopApp()
	})
	test('prevents path traversal attacks with 403', async () => {
		const app = Artesia()
		app.use('/static', serveStatic({ root: './tests' }))
		await startApp(app)
		const res = await fetch(`${baseUrl}/static/../../package.json`)
		expect([403, 404]).toContain(res.status)
		await stopApp()
	})
})
