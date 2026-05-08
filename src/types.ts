import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HTTPMethod } from 'find-my-way'

export type { HTTPMethod }

export type HttpRedirectType = 301 | 302 | 303 | 307 | 308

export type HttpStatusText =
	| 'Continue'
	| 'Switching Protocols'
	| 'Processing'
	| 'Early Hints'
	| 'OK'
	| 'Created'
	| 'Accepted'
	| 'Non-Authoritative Information'
	| 'No Content'
	| 'Reset Content'
	| 'Partial Content'
	| 'Multi-Status'
	| 'Already Reported'
	| 'IM Used'
	| 'Multiple Choices'
	| 'Moved Permanently'
	| 'Found'
	| 'See Other'
	| 'Not Modified'
	| 'Use Proxy'
	| 'Temporary Redirect'
	| 'Permanent Redirect'
	| 'Bad Request'
	| 'Unauthorized'
	| 'Payment Required'
	| 'Forbidden'
	| 'Not Found'
	| 'Method Not Allowed'
	| 'Not Acceptable'
	| 'Proxy Authentication Required'
	| 'Request Timeout'
	| 'Conflict'
	| 'Gone'
	| 'Length Required'
	| 'Precondition Failed'
	| 'Content Too Large'
	| 'URI Too Long'
	| 'Unsupported Media Type'
	| 'Range Not Satisfiable'
	| 'Expectation Failed'
	| "I'm a Teapot"
	| 'Misdirected Request'
	| 'Unprocessable Content'
	| 'Locked'
	| 'Failed Dependency'
	| 'Too Early'
	| 'Upgrade Required'
	| 'Precondition Required'
	| 'Too Many Requests'
	| 'Request Header Fields Too Large'
	| 'Unavailable For Legal Reasons'
	| 'Internal Server Error'
	| 'Not Implemented'
	| 'Bad Gateway'
	| 'Service Unavailable'
	| 'Gateway Timeout'
	| 'HTTP Version Not Supported'
	| 'Variant Also Negotiates'
	| 'Insufficient Storage'
	| 'Loop Detected'
	| 'Not Extended'
	| 'Network Authentication Required'

type ExtractSegments<Path extends string> = Path extends `${infer Head}/${infer Tail}` ? Head | ExtractSegments<Tail> : Path

type FilterParams<S extends string> = S extends `:${infer Name}` ? Name : never

export type ExtractParams<Path extends string> = {
	[K in FilterParams<ExtractSegments<Path>>]: string
} & (Path extends `*` | `${string}/*` ? { '*': string } : object)

export type ParamMap<Path extends string> = Omit<Map<string, string>, 'get'> & {
	get<K extends keyof ExtractParams<Path>>(key: K): string
	get(key: string): string | undefined
}

export type HttpRequest = IncomingMessage
export type HttpRawResponse = ServerResponse

export interface CookieOptions {
	maxAge?: number
	expires?: Date
	httpOnly?: boolean
	secure?: boolean
	sameSite?: 'strict' | 'lax' | 'none'
	path?: string
	domain?: string
}

export interface ContextFile {
	fieldname: string
	filename: string
	mimetype: string
	encoding: string
	buffer: Buffer
	size: number
}

export interface FileOptions {
	contentType?: string
	filename?: string
	disposition?: 'inline' | 'attachment'
}

export interface ArtesiaResponse {
	readonly __artesia: true
	body: string | Buffer | null
	status: number
	headers: Map<string, string | string[]>
}

export function isArtesiaResponse(v: unknown): v is ArtesiaResponse {
	return typeof v === 'object' && v !== null && (v as ArtesiaResponse).__artesia === true
}

export interface SetResponse {
	headers(value: Headers): void
	headers(value: Map<string, string | number | readonly string[]>): void
	headers(value: Record<string, string | number | readonly string[]>): void
	headers(header: string, value: string | number | readonly string[]): void
	cookies(value: Record<string, string>, options?: CookieOptions): void
	cookies(name: string, value: string, options?: CookieOptions): void
	status(status: number): void
	status(status: HttpStatusText): void
}

export interface Context<Path extends string = string> {
	set: SetResponse
	redirect(path: string, status?: HttpRedirectType): ArtesiaResponse
	cookie(name: string): string | undefined
	searchParams: URLSearchParams
	request: HttpRequest
	params: ParamMap<Path>
	store: Map<string, unknown>
	method: HTTPMethod
	pathname: string
	headers: Headers
	files: ContextFile[]
	rawBody: Buffer | null
	body: unknown
	html(content: string, status?: number): ArtesiaResponse
	file(filePath: string, options?: FileOptions): Promise<ArtesiaResponse>
}

export type Handler<Path extends string = string> = (ctx: Context<Path>) => unknown | Promise<unknown>

export type Middleware = (ctx: Context, next: () => Promise<void>) => unknown | Promise<unknown>

export interface RouteDefinition {
	method: HTTPMethod
	path: string
	handlers: Handler[]
}

export interface ArtesiaOptions {
	basePath?: string
}

export const HTTP_STATUS: Record<HttpStatusText, number> = {
	Continue: 100,
	'Switching Protocols': 101,
	Processing: 102,
	'Early Hints': 103,
	OK: 200,
	Created: 201,
	Accepted: 202,
	'Non-Authoritative Information': 203,
	'No Content': 204,
	'Reset Content': 205,
	'Partial Content': 206,
	'Multi-Status': 207,
	'Already Reported': 208,
	'IM Used': 226,
	'Multiple Choices': 300,
	'Moved Permanently': 301,
	Found: 302,
	'See Other': 303,
	'Not Modified': 304,
	'Use Proxy': 305,
	'Temporary Redirect': 307,
	'Permanent Redirect': 308,
	'Bad Request': 400,
	Unauthorized: 401,
	'Payment Required': 402,
	Forbidden: 403,
	'Not Found': 404,
	'Method Not Allowed': 405,
	'Not Acceptable': 406,
	'Proxy Authentication Required': 407,
	'Request Timeout': 408,
	Conflict: 409,
	Gone: 410,
	'Length Required': 411,
	'Precondition Failed': 412,
	'Content Too Large': 413,
	'URI Too Long': 414,
	'Unsupported Media Type': 415,
	'Range Not Satisfiable': 416,
	'Expectation Failed': 417,
	"I'm a Teapot": 418,
	'Misdirected Request': 421,
	'Unprocessable Content': 422,
	Locked: 423,
	'Failed Dependency': 424,
	'Too Early': 425,
	'Upgrade Required': 426,
	'Precondition Required': 428,
	'Too Many Requests': 429,
	'Request Header Fields Too Large': 431,
	'Unavailable For Legal Reasons': 451,
	'Internal Server Error': 500,
	'Not Implemented': 501,
	'Bad Gateway': 502,
	'Service Unavailable': 503,
	'Gateway Timeout': 504,
	'HTTP Version Not Supported': 505,
	'Variant Also Negotiates': 506,
	'Insufficient Storage': 507,
	'Loop Detected': 508,
	'Not Extended': 510,
	'Network Authentication Required': 511
}
