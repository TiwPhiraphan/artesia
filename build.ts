import { rm } from 'node:fs/promises'
import { build } from 'tsup'

await rm('./dist', { recursive: true, force: true })

await build({
	entry: ['src/index.ts', 'src/middleware.ts'],
	outDir: 'dist',
	format: ['esm', 'cjs'],
	target: 'node20',
	minifySyntax: true,
	minifyWhitespace: true,
	minifyIdentifiers: true,
	splitting: false,
	sourcemap: false,
	cjsInterop: true,
	clean: true,
	bundle: true,
	dts: true
})

await build({
	entry: ['bin/create-app.ts'],
	outDir: 'bin',
	format: 'esm',
	target: 'node20',
	minifySyntax: true,
	minifyWhitespace: true,
	minifyIdentifiers: true,
	splitting: false,
	sourcemap: false,
	clean: false,
	bundle: true
})
