import { Artesia, artesia } from './artesia'

export type { ArtesiaConstructor, HTTPMethod } from './artesia'
export { makeArtesiaResponse } from './context'
export type {
	CorsOptions,
	LogFields,
	LoggerOptions,
	RequestIdOptions,
	SecureHeadersOptions,
	ServeStaticOptions
} from './middleware'
export {
	buildMiddleware,
	cors,
	logger,
	requestId,
	secureHeaders,
	serveStatic
} from './middleware'
export type {
	ArtesiaOptions,
	ArtesiaResponse,
	Context,
	ContextFile,
	CookieOptions,
	ErrorHandler,
	ExtractParams,
	FileOptions,
	Handler,
	HttpRawResponse,
	HttpRedirectType,
	HttpRequest,
	HttpStatusText,
	Middleware,
	NotFoundHandler,
	ParamMap,
	RouteDefinition,
	SetResponse
} from './types'
export { HTTP_STATUS, isArtesiaResponse } from './types'
export { Artesia, artesia }

export default Artesia
