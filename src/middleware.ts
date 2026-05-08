import type { Context, Middleware } from './types'

/**
 * Helper to create a typed middleware function.
 *
 * Useful for authoring reusable middleware with full TypeScript support
 * without needing to import or annotate the `Middleware` type manually.
 *
 * @example
 * ```ts
 * import { buildMiddleware } from 'artesia/middleware'
 *
 * // Simple auth guard
 * const requireAuth = buildMiddleware((ctx, next) => {
 *   const token = ctx.headers.get('authorization')
 *   if (!token) {
 *     ctx.set.status(401)
 *     return { error: 'Unauthorized' }
 *   }
 *   return next()
 * })
 *
 * app.use(requireAuth)
 * ```
 *
 * @example
 * ```ts
 * // Middleware factory pattern
 * function rateLimit(maxRpm: number) {
 *   const counts = new Map<string, number>()
 *
 *   return buildMiddleware((ctx, next) => {
 *     const ip = ctx.headers.get('x-forwarded-for') ?? 'unknown'
 *     const count = (counts.get(ip) ?? 0) + 1
 *     counts.set(ip, count)
 *     if (count > maxRpm) {
 *       ctx.set.status(429)
 *       return { error: 'Too Many Requests' }
 *     }
 *     return next()
 *   })
 * }
 *
 * app.use(rateLimit(60))
 * ```
 */
export function buildMiddleware(fn: Middleware): Middleware {
	return fn
}

export interface CorsOptions {
	/**
	 * Allowed origins.
	 *
	 * - `'*'` — allow all origins (default)
	 * - `string` — single allowed origin, e.g. `'https://example.com'`
	 * - `string[]` — list of allowed origins
	 * - `RegExp` — test the request origin against a pattern
	 * - `(origin: string) => boolean` — custom predicate
	 */
	origin?: '*' | string | string[] | RegExp | ((origin: string) => boolean)
	/**
	 * Allowed HTTP methods.
	 * @default ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
	 */
	methods?: ('GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS')[]
	/**
	 * Allowed request headers.
	 * When omitted, reflects the value of `Access-Control-Request-Headers`.
	 */
	allowedHeaders?: string[]
	/**
	 * Headers to expose to the browser.
	 */
	exposedHeaders?: string[]
	/**
	 * Whether to allow cookies / credentials.
	 * @default false
	 */
	credentials?: boolean
	/**
	 * How long (in seconds) the browser may cache the preflight response.
	 * @default 5
	 */
	maxAge?: number
}

const DEFAULT_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

function resolveOrigin(allowed: CorsOptions['origin'], requestOrigin: string | null): string | null {
	if (!requestOrigin) return null
	if (!allowed || allowed === '*') return '*'
	if (typeof allowed === 'string') {
		return allowed === requestOrigin ? allowed : null
	}
	if (Array.isArray(allowed)) {
		return allowed.includes(requestOrigin) ? requestOrigin : null
	}
	if (allowed instanceof RegExp) {
		return allowed.test(requestOrigin) ? requestOrigin : null
	}
	if (typeof allowed === 'function') {
		return allowed(requestOrigin) ? requestOrigin : null
	}
	return null
}

function applyCorsHeaders(ctx: Context, resolvedOrigin: string, credentials: boolean, exposedValue: string | undefined): void {
	ctx.set.headers('access-control-allow-origin', resolvedOrigin)
	if (resolvedOrigin !== '*') {
		ctx.set.headers('vary', 'Origin')
	}
	if (credentials) {
		ctx.set.headers('access-control-allow-credentials', 'true')
	}
	if (exposedValue) {
		ctx.set.headers('access-control-expose-headers', exposedValue)
	}
}

/**
 * CORS middleware.
 *
 * @example
 * ```ts
 * import { Artesia } from 'artesia'
 * import { cors } from 'artesia/middleware'
 *
 * const app = Artesia()
 *
 * // Allow all origins
 * app.use(cors())
 *
 * // Restrict to specific origins
 * app.use(cors({
 *   origin: ['https://example.com', 'https://admin.example.com'],
 *   credentials: true,
 * }))
 * ```
 */
export function cors(options: CorsOptions = {}): Middleware {
	const { origin = '*', methods = DEFAULT_METHODS, allowedHeaders, exposedHeaders, credentials = false, maxAge = 5 } = options
	const methodsValue = (methods as string[]).join(', ')
	const exposedValue = exposedHeaders?.join(', ')
	return buildMiddleware(async (ctx, next) => {
		const requestOrigin = ctx.headers.get('origin')
		if (!requestOrigin) {
			return next()
		}
		const resolvedOrigin = resolveOrigin(origin, requestOrigin)
		if (ctx.method === 'OPTIONS') {
			if (resolvedOrigin) {
				applyCorsHeaders(ctx, resolvedOrigin, credentials, exposedValue)
				ctx.set.headers('access-control-allow-methods', methodsValue)

				const requestedHeaders = ctx.headers.get('access-control-request-headers')
				const headersValue = allowedHeaders ? allowedHeaders.join(', ') : (requestedHeaders ?? '')
				if (headersValue) {
					ctx.set.headers('access-control-allow-headers', headersValue)
				}
				ctx.set.headers('access-control-max-age', String(maxAge))
				ctx.set.status(204)
				return null
			}
			return next()
		}
		if (resolvedOrigin) {
			applyCorsHeaders(ctx, resolvedOrigin, credentials, exposedValue)
		}
		return next()
	})
}

const C = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	white: '\x1b[37m',
	gray: '\x1b[90m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
	magenta: '\x1b[35m',
	cyan: '\x1b[36m',
	blue: '\x1b[34m'
} as const

const ANSI_RE = /\x1b\[[0-9;]*m/g

function visibleLength(s: string): number {
	ANSI_RE.lastIndex = 0
	return s.replace(ANSI_RE, '').length
}

function padEndVisible(s: string, width: number): string {
	const pad = width - visibleLength(s)
	return pad > 0 ? s + ' '.repeat(pad) : s
}

function colourMethod(method: string): string {
	switch (method) {
		case 'GET':
			return `${C.green}${C.bold}${method}${C.reset}`
		case 'POST':
			return `${C.cyan}${C.bold}${method}${C.reset}`
		case 'PUT':
			return `${C.yellow}${C.bold}${method}${C.reset}`
		case 'PATCH':
			return `${C.magenta}${C.bold}${method}${C.reset}`
		case 'DELETE':
			return `${C.red}${C.bold}${method}${C.reset}`
		case 'HEAD':
			return `${C.blue}${C.bold}${method}${C.reset}`
		case 'OPTIONS':
			return `${C.white}${C.bold}${method}${C.reset}`
		default:
			return `${C.white}${C.bold}${method}${C.reset}`
	}
}

function colourStatus(status: number): string {
	if (status < 300) return `${C.green}${status}${C.reset}`
	if (status < 400) return `${C.cyan}${status}${C.reset}`
	if (status < 500) return `${C.yellow}${status}${C.reset}`
	return `${C.red}${status}${C.reset}`
}

function colourDuration(ms: number): string {
	if (ms < 50) return `${C.green}${ms}ms${C.reset}`
	if (ms < 200) return `${C.yellow}${ms}ms${C.reset}`
	return `${C.red}${ms}ms${C.reset}`
}

function isoTimestamp(): string {
	return new Date().toISOString().replace('T', ' ').slice(0, 23)
}

export interface LogFields {
	method: string
	pathname: string
	status: number
	durationMs: number
	contentLength: string | null
	timestamp: string
}

export interface LoggerOptions {
	/**
	 * Custom log function. Receives the pre-built log string and structured fields.
	 * Defaults to `console.log`.
	 *
	 * @example
	 * ```ts
	 * logger({
	 *   log: (line, fields) => {
	 *     myExternalLogger.info(fields)
	 *   }
	 * })
	 * ```
	 */
	log?: (line: string, fields: LogFields) => void

	/**
	 * Whether to print ANSI colour codes.
	 * Auto-detected from `process.stdout.isTTY` when omitted.
	 */
	colorize?: boolean

	/**
	 * Skip logging for specific requests.
	 *
	 * @example
	 * ```ts
	 * // Skip health-check and static assets
	 * logger({ skip: (ctx) => ctx.pathname === '/health' })
	 * ```
	 */
	skip?: (fields: Pick<LogFields, 'method' | 'pathname'>) => boolean

	/**
	 * Format of the timestamp shown in each log line.
	 * - `'iso'` — `2025-01-15 12:34:56.789` (default)
	 * - `'time'` — `12:34:56`
	 * - `false` — no timestamp
	 */
	timestamp?: 'iso' | 'time' | false
}

/**
 * HTTP request logger middleware.
 *
 * Logs method, path, status code, and response time for every request.
 *
 * @example
 * ```ts
 * import { Artesia } from 'artesia'
 * import { logger } from 'artesia/middleware'
 *
 * const app = Artesia()
 *
 * // Default — pretty coloured output
 * app.use(logger())
 *
 * // Custom log function (e.g. for structured logging)
 * app.use(logger({
 *   log: (_, fields) => console.log(JSON.stringify(fields)),
 * }))
 *
 * // Skip health checks
 * app.use(logger({
 *   skip: ({ pathname }) => pathname === '/health',
 * }))
 * ```
 */
export function logger(options: LoggerOptions = {}): Middleware {
	const { log: customLog, colorize = (typeof process !== 'undefined' && process.stdout?.isTTY) ?? true, skip, timestamp: tsFormat = 'iso' } = options
	function getTimestamp(): string {
		if (tsFormat === false) return ''
		if (tsFormat === 'time') return new Date().toTimeString().slice(0, 8)
		return isoTimestamp()
	}
	return buildMiddleware(async (ctx, next) => {
		const { method, pathname } = ctx
		if (skip?.({ method, pathname })) {
			return next()
		}
		const start = performance.now()
		await next()
		const durationMs = Math.round(performance.now() - start)
		const rawStatus = (ctx as unknown as { __responseStatus?: { value: number } }).__responseStatus?.value ?? 200
		const ts = getTimestamp()
		const fields: LogFields = {
			method,
			pathname,
			status: rawStatus,
			durationMs,
			contentLength: null,
			timestamp: ts
		}
		let line: string
		if (colorize) {
			const tsStr = ts ? `${C.gray}${ts}${C.reset} ` : ''
			const methodColoured = colourMethod(method)
			const methodPadded = padEndVisible(methodColoured, 7)
			const pathStr = `${C.white}${pathname}${C.reset}`
			const statusStr = colourStatus(rawStatus)
			const durStr = colourDuration(durationMs)
			line = `${tsStr}${methodPadded} ${pathStr} ${C.dim}→${C.reset} ${statusStr} ${C.dim}(${C.reset}${durStr}${C.dim})${C.reset}`
		} else {
			const tsStr = ts ? `${ts} ` : ''
			line = `${tsStr}${method.padEnd(7)} ${pathname} → ${rawStatus} (${durationMs}ms)`
		}
		if (customLog) {
			customLog(line, fields)
		} else {
			console.log(line)
		}
	})
}
