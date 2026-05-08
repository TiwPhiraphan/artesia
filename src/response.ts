import type { ServerResponse } from 'node:http'
import { type ArtesiaResponse, isArtesiaResponse } from './types'

function mergeHeaders(res: ServerResponse, extra: Map<string, string | string[]>): void {
	for (const [key, val] of extra) {
		if (Array.isArray(val)) {
			for (const v of val) res.appendHeader(key, v)
		} else {
			res.setHeader(key, val)
		}
	}
}

export function sendArtesiaResponse(res: ServerResponse, fr: ArtesiaResponse, ctxHeaders: Map<string, string | string[]>, ctxStatus: number): void {
	for (const [k, v] of ctxHeaders) {
		if (!fr.headers.has(k)) {
			fr.headers.set(k, v)
		}
	}
	res.statusCode = fr.status !== 200 ? fr.status : ctxStatus
	mergeHeaders(res, fr.headers)
	if (fr.body === null) {
		res.end()
		return
	}
	if (Buffer.isBuffer(fr.body)) {
		if (!fr.headers.has('content-length')) {
			res.setHeader('content-length', fr.body.byteLength)
		}
		res.end(fr.body)
		return
	}
	const encoded = Buffer.from(fr.body, 'utf8')
	if (!fr.headers.has('content-length')) {
		res.setHeader('content-length', encoded.byteLength)
	}
	res.end(encoded)
}

export function sendValue(res: ServerResponse, value: unknown, ctxHeaders: Map<string, string | string[]>, ctxStatus: number): void {
	if (isArtesiaResponse(value)) {
		sendArtesiaResponse(res, value, ctxHeaders, ctxStatus)
		return
	}
	res.statusCode = ctxStatus
	mergeHeaders(res, ctxHeaders)
	if (value === null || value === undefined) {
		res.statusCode = ctxStatus === 200 ? 204 : ctxStatus
		res.end()
		return
	}
	if (Buffer.isBuffer(value)) {
		if (!res.hasHeader('content-type')) {
			res.setHeader('content-type', 'application/octet-stream')
		}
		res.setHeader('content-length', value.byteLength)
		res.end(value)
		return
	}
	if (typeof value === 'string') {
		if (!res.hasHeader('content-type')) {
			res.setHeader('content-type', 'text/plain; charset=utf-8')
		}
		const buf = Buffer.from(value, 'utf8')
		res.setHeader('content-length', buf.byteLength)
		res.end(buf)
		return
	}
	const json = JSON.stringify(value)
	const buf = Buffer.from(json, 'utf8')
	if (!res.hasHeader('content-type')) {
		res.setHeader('content-type', 'application/json; charset=utf-8')
	}
	res.setHeader('content-length', buf.byteLength)
	res.end(buf)
}
