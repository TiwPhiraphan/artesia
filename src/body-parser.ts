import type { IncomingMessage } from 'node:http'
import busboy from 'busboy'
import type { ContextFile } from './types'

export interface ParsedBody {
	body: unknown
	rawBody: Buffer | null
	files: ContextFile[]
}

function readRaw(req: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		req.on('data', (chunk: Buffer) => chunks.push(chunk))
		req.on('end', () => resolve(Buffer.concat(chunks)))
		req.on('error', reject)
	})
}

function parseMultipart(req: IncomingMessage, contentType: string): Promise<{ fields: Record<string, string>; files: ContextFile[] }> {
	return new Promise((resolve, reject) => {
		const fields: Record<string, string> = {}
		const files: ContextFile[] = []
		const bb = busboy({ headers: { 'content-type': contentType } })
		bb.on('file', (fieldname, stream, info) => {
			const { filename, encoding, mimeType } = info
			const chunks: Buffer[] = []
			stream.on('data', (chunk: Buffer) => chunks.push(chunk))
			stream.on('end', () => {
				const buffer = Buffer.concat(chunks)
				files.push({
					fieldname,
					filename,
					encoding,
					mimetype: mimeType,
					buffer,
					size: buffer.byteLength
				})
			})
			stream.on('error', reject)
		})
		bb.on('field', (name, val) => {
			fields[name] = val
		})
		bb.on('close', () => resolve({ fields, files }))
		bb.on('error', reject)
		req.pipe(bb)
	})
}

export async function parseBody(req: IncomingMessage): Promise<ParsedBody> {
	const contentType = req.headers['content-type'] ?? ''
	const method = (req.method ?? 'GET').toUpperCase()
	if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
		return { body: null, rawBody: null, files: [] }
	}
	if (contentType.includes('multipart/form-data')) {
		const { fields, files } = await parseMultipart(req, contentType)
		return {
			body: fields,
			rawBody: null,
			files
		}
	}
	const rawBody = await readRaw(req)
	if (rawBody.byteLength === 0) {
		return { body: null, rawBody: null, files: [] }
	}
	if (contentType.includes('application/json')) {
		try {
			return { body: JSON.parse(rawBody.toString('utf8')), rawBody, files: [] }
		} catch {
			return { body: null, rawBody, files: [] }
		}
	}
	if (contentType.includes('application/x-www-form-urlencoded')) {
		const params = new URLSearchParams(rawBody.toString('utf8'))
		const body: Record<string, string | string[]> = {}
		for (const [key, val] of params) {
			const existing = body[key]
			if (existing === undefined) {
				body[key] = val
			} else if (Array.isArray(existing)) {
				existing.push(val)
			} else {
				body[key] = [existing, val]
			}
		}
		return { body, rawBody, files: [] }
	}
	if (contentType.startsWith('text/')) {
		return { body: rawBody.toString('utf8'), rawBody, files: [] }
	}
	return { body: rawBody, rawBody, files: [] }
}
