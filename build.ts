import { rm } from 'node:fs/promises'
import { $ } from 'bun'
import { build } from 'tsup'

await rm('./dist', { recursive: true, force: true })

await $`bunx tsc -p tsconfig.build.json --emitDeclarationOnly`

await build({
	entry: ['src/**/*.ts'],
	outDir: 'dist',
	format: ['esm', 'cjs'],
	target: 'node20',
	minifySyntax: true,
	minifyWhitespace: true,
	minifyIdentifiers: true,
	splitting: false,
	sourcemap: false,
	cjsInterop: false,
	clean: false,
	bundle: false
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
