import type { IncomingMessage } from 'node:http'
import busboy from 'busboy'
import type { ContextFile } from './types'

export interface ParsedBody {
	body: unknown
	rawBody: Buffer | null
	files: ContextFile[]
}

function readRaw(req: IncomingMessage, maxBodySize?: number): Promise<Buffer> {
	if (req.readableEnded) {
		return Promise.resolve(Buffer.alloc(0))
	}
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		let bytesRead = 0
		req.on('data', (chunk: Buffer) => {
			bytesRead += chunk.byteLength
			if (maxBodySize && bytesRead > maxBodySize) {
				const err = new Error('Payload Too Large')
				;(err as unknown as { status: number }).status = 413
				req.destroy()
				reject(err)
				return
			}
			chunks.push(chunk)
		})
		req.on('end', () => resolve(Buffer.concat(chunks)))
		req.on('error', reject)
	})
}

function parseMultipart(req: IncomingMessage, contentType: string, maxBodySize?: number): Promise<{ fields: Record<string, string>; files: ContextFile[] }> {
	return new Promise((resolve, reject) => {
		const fields: Record<string, string> = {}
		const files: ContextFile[] = []
		let bb: ReturnType<typeof busboy>
		try {
			bb = busboy({
				headers: { 'content-type': contentType },
				limits: maxBodySize ? { fileSize: maxBodySize } : undefined
			})
		} catch {
			return resolve({ fields, files })
		}
		const filePromises: Promise<void>[] = []
		bb.on('file', (fieldname, stream, info) => {
			const { filename, encoding, mimeType } = info
			const chunks: Buffer[] = []
			filePromises.push(
				new Promise((resFile, rejFile) => {
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
						resFile()
					})
					stream.on('error', rejFile)
				})
			)
		})
		bb.on('field', (name, val) => {
			fields[name] = val
		})
		bb.on('close', async () => {
			try {
				await Promise.all(filePromises)
				resolve({ fields, files })
			} catch (err) {
				reject(err)
			}
		})
		bb.on('error', () => {
			resolve({ fields, files })
		})
		req.pipe(bb)
	})
}

export async function parseBody(req: IncomingMessage, maxBodySize?: number): Promise<ParsedBody> {
	const contentType = req.headers['content-type'] ?? ''
	const method = (req.method ?? 'GET').toUpperCase()
	if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
		return { body: null, rawBody: null, files: [] }
	}
	const cl = req.headers['content-length']
	if (maxBodySize && cl && Number(cl) > maxBodySize) {
		const err = new Error('Payload Too Large')
		;(err as unknown as { status: number }).status = 413
		throw err
	}
	if (contentType.includes('multipart/form-data')) {
		const { fields, files } = await parseMultipart(req, contentType, maxBodySize)
		return {
			body: fields,
			rawBody: null,
			files
		}
	}
	const rawBody = await readRaw(req, maxBodySize)
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
