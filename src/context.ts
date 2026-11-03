import { readFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { extname } from 'node:path'
import { serialize as serializeCookie } from 'cookie'
import type { ArtesiaResponse, Context, ContextFile, CookieOptions, FileOptions, HTTPMethod, HttpRedirectType, HttpStatusText, ParamMap, SetResponse } from './types'
import { HTTP_STATUS } from './types'

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.htm': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.ts': 'application/typescript',
	'.txt': 'text/plain; charset=utf-8',
	'.md': 'text/markdown; charset=utf-8',
	'.xml': 'application/xml; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.pdf': 'application/pdf',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.zip': 'application/zip',
	'.gz': 'application/gzip',
	'.wasm': 'application/wasm',
	'.avif': 'image/avif',
	'.csv': 'text/csv; charset=utf-8',
	'.map': 'application/json; charset=utf-8'
}

function lookupMime(filePath: string): string {
	const ext = extname(filePath).toLowerCase()
	return MIME[ext] ?? 'application/octet-stream'
}

export function makeArtesiaResponse(body: string | Buffer | null, status = 200, headers?: Record<string, string | string[]>): ArtesiaResponse {
	const map = new Map<string, string | string[]>()
	if (headers) {
		for (const [k, v] of Object.entries(headers)) {
			map.set(k.toLowerCase(), v)
		}
	}
	return { __artesia: true, body, status, headers: map }
}

export function buildSetResponse(responseHeaders: Map<string, string | string[]>, responseStatus: { value: number }): SetResponse {
	function normalizeHeaderValue(v: string | number | readonly string[]): string | string[] {
		if (typeof v === 'number') return String(v)
		if (typeof v === 'string') return v
		return v as string[]
	}
	return {
		headers(...args: unknown[]): void {
			if (args.length === 0 || args[0] == null) {
				return
			}
			if (args.length >= 2) {
				const [name, value] = args as [string, string | number | readonly string[]]
				if (typeof name === 'string' && value !== undefined) {
					responseHeaders.set(name.toLowerCase(), normalizeHeaderValue(value))
				}
				return
			}
			const [value] = args as [Headers | Map<string, string | number | readonly string[]> | Record<string, string | number | readonly string[]>]
			if (!value) return
			if (value instanceof Headers) {
				for (const [k, v] of value.entries()) {
					responseHeaders.set(k.toLowerCase(), v)
				}
			} else if (value instanceof Map) {
				for (const [k, v] of value.entries()) {
					responseHeaders.set(k.toLowerCase(), normalizeHeaderValue(v))
				}
			} else if (typeof value === 'object') {
				for (const [k, v] of Object.entries(value)) {
					if (v !== undefined) {
						responseHeaders.set(k.toLowerCase(), normalizeHeaderValue(v))
					}
				}
			}
		},
		cookies(...args: unknown[]): void {
			if (args.length === 0 || args[0] == null) return
			const setCookieValues: string[] = []
			if (typeof args[0] === 'string') {
				const [name, value, options] = args as [string, string, CookieOptions?]
				if (typeof value === 'string') {
					setCookieValues.push(serializeCookie(name, value, options))
				}
			} else if (typeof args[0] === 'object') {
				const [obj, options] = args as [Record<string, string>, CookieOptions?]
				for (const [name, value] of Object.entries(obj)) {
					if (typeof value === 'string') {
						setCookieValues.push(serializeCookie(name, value, options))
					}
				}
			}
			if (setCookieValues.length === 0) return
			const existing = responseHeaders.get('set-cookie')
			const combined = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...setCookieValues]
			responseHeaders.set('set-cookie', combined)
		},
		status(s: number | HttpStatusText): void {
			if (typeof s === 'number') {
				responseStatus.value = s
			} else {
				responseStatus.value = HTTP_STATUS[s] ?? 200
			}
		}
	}
}

export function buildContext<Path extends string>(options: {
	req: IncomingMessage
	method: HTTPMethod
	pathname: string
	params: Record<string, string>
	body: unknown
	rawBody: Buffer | null
	files: ContextFile[]
	store: Map<string, unknown>
	cookies: Record<string, string>
	poweredBy?: string | null
}): Context<Path> {
	const { req, method, pathname, params, body, rawBody, files, store, cookies, poweredBy } = options
	const responseHeaders = new Map<string, string | string[]>()
	if (poweredBy) {
		responseHeaders.set('x-powered-by', poweredBy)
	}
	const responseStatus = { value: 200 }
	const paramMap = new Map<string, string>(Object.entries(params)) as ParamMap<Path>
	const headers = new Headers()
	for (const [k, v] of Object.entries(req.headers)) {
		if (v === undefined) continue
		if (Array.isArray(v)) {
			for (const item of v) headers.append(k, item)
		} else {
			headers.set(k, v)
		}
	}
	const rawUrl = req.url ?? '/'
	const qIdx = rawUrl.indexOf('?')
	const searchParams = new URLSearchParams(qIdx >= 0 ? rawUrl.slice(qIdx + 1) : '')
	const set = buildSetResponse(responseHeaders, responseStatus)
	const ctx: Context<Path> = {
		set,
		request: req,
		method,
		pathname,
		headers,
		searchParams,
		params: paramMap,
		store,
		files,
		rawBody,
		body,
		cookie(name: string): string | undefined {
			return Object.hasOwn(cookies, name) ? cookies[name] : undefined
		},
		redirect(path: string, status: HttpRedirectType = 302): ArtesiaResponse {
			return makeArtesiaResponse(null, status, { location: path })
		},
		html(content: string, status = 200): ArtesiaResponse {
			return makeArtesiaResponse(content, status, {
				'content-type': 'text/html; charset=utf-8'
			})
		},
		async file(filePath: string, opts: FileOptions = {}): Promise<ArtesiaResponse> {
			const buffer = await readFile(filePath)
			const contentType = opts.contentType ?? lookupMime(filePath)
			const safeFilename = opts.filename ? opts.filename.replace(/"/g, '\\"') : undefined
			const disposition =
				opts.disposition === 'attachment'
					? `attachment${safeFilename ? `; filename="${safeFilename}"` : ''}`
					: `inline${safeFilename ? `; filename="${safeFilename}"` : ''}`
			return makeArtesiaResponse(buffer, 200, {
				'content-type': contentType,
				'content-disposition': disposition,
				'content-length': String(buffer.byteLength)
			})
		}
	}
	Object.defineProperty(ctx, '__responseHeaders', { value: responseHeaders, enumerable: false })
	Object.defineProperty(ctx, '__responseStatus', { value: responseStatus, enumerable: false })
	return ctx
}

export function getResponseMeta(ctx: Context): {
	headers: Map<string, string | string[]>
	status: { value: number }
} {
	return {
		headers: (ctx as unknown as { __responseHeaders: Map<string, string | string[]> }).__responseHeaders,
		status: (ctx as unknown as { __responseStatus: { value: number } }).__responseStatus
	}
}
