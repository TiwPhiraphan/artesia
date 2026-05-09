import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'node:http'
import { Artesia } from '../src/artesia'

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
