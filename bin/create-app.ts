#!/usr/bin/env node

// @ts-nocheck

import { execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cancel, confirm, intro, isCancel, log, outro, select, spinner, text } from '@clack/prompts'

// ─── Detect package manager ───────────────────────────────────────────────────

function detectPackageManager(): 'bun' | 'pnpm' | 'yarn' | 'npm' {
	try {
		const ua = process.env.npm_config_user_agent ?? ''
		if (ua.startsWith('bun')) return 'bun'
		if (ua.startsWith('pnpm')) return 'pnpm'
		if (ua.startsWith('yarn')) return 'yarn'
	} catch {}

	const checks: Array<['bun' | 'pnpm' | 'yarn' | 'npm', string]> = [
		['bun', 'bun --version'],
		['pnpm', 'pnpm --version'],
		['yarn', 'yarn --version']
	]
	for (const [pm, cmd] of checks) {
		try {
			execSync(cmd, { stdio: 'ignore' })
			return pm
		} catch {}
	}
	return 'npm'
}

function installCmd(pm: string): string {
	return pm === 'yarn' ? 'yarn' : `${pm} install`
}

// ─── Scripts helper ───────────────────────────────────────────────────────────

function scripts(pm: string, useTs: boolean): Record<string, string> {
	const ext = useTs ? 'ts' : 'js'
	const entry = `src/index.${ext}`

	if (pm === 'bun') {
		return {
			dev: `bun --watch ${entry}`,
			start: `bun ${entry}`,
			...(useTs && { build: `bun build ${entry} --outdir dist --target node` })
		}
	}

	return {
		dev: useTs ? `tsx watch ${entry}` : `node --watch ${entry}`,
		start: useTs ? `tsx ${entry}` : `node ${entry}`,
		...(useTs && { build: 'tsc --outDir dist' })
	}
}

// ─── Templates ────────────────────────────────────────────────────────────────

function packageJson(name: string, useTs: boolean, pm: string) {
	return JSON.stringify(
		{
			name,
			version: '0.0.1',
			private: true,
			scripts: scripts(pm, useTs),
			dependencies: {
				artesia: 'latest'
			},
			...(useTs && {
				devDependencies: {
					...(pm === 'bun' ? { '@types/bun': 'latest' } : { '@types/node': 'latest', tsx: 'latest' }),
					typescript: 'latest'
				}
			})
		},
		null,
		2
	)
}

function tsConfig(pm: string) {
	return JSON.stringify(
		{
			compilerOptions: {
				target: 'ESNext',
				module: 'ESNext',
				moduleResolution: pm === 'bun' ? 'bundler' : 'node16',
				strict: true,
				types: pm === 'bun' ? ['bun'] : ['node']
			},
			include: ['src']
		},
		null,
		2
	)
}

function indexFile() {
	return "import { Artesia } from 'artesia'\n\nconst app = new Artesia()\n\napp.get('/', (ctx) => {\n\treturn { message: 'Hello World!' }\n})\n\napp.get('/users/:id', (ctx) => {\n\tconst id = ctx.params.get('id')\n\treturn { id, name: 'Alice' }\n})\n\napp.listen(3000)\n"
}

function gitignore() {
	return `node_modules
dist
.env
.env.local
`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
	console.log('')
	intro(' create-http-app ')

	// Project name
	const nameInput = await text({
		message: 'Project name',
		placeholder: 'my-app',
		defaultValue: 'my-app',
		validate(v) {
            const val = v.trim()
			if (!v || !val) return 'Project name is required'
			if (!/^[a-z0-9-_]+$/.test(v)) return 'Use lowercase letters, numbers, hyphens, underscores only'
			if (existsSync(v)) return `Directory "${v}" already exists`
		}
	})
	if (isCancel(nameInput)) {
		cancel('Cancelled')
		process.exit(0)
	}
	const projectName = nameInput as string

	// TypeScript or JavaScript
	const lang = await select({
		message: 'Language',
		options: [
			{ value: 'ts', label: 'TypeScript', hint: 'recommended' },
			{ value: 'js', label: 'JavaScript' }
		]
	})
	if (isCancel(lang)) {
		cancel('Cancelled')
		process.exit(0)
	}
	const useTs = lang === 'ts'

	// Package manager
	const detected = detectPackageManager()
	const pm = await select({
		message: 'Package manager',
		options: [
			{ value: 'bun', label: 'bun', hint: detected === 'bun' ? 'detected' : '' },
			{ value: 'pnpm', label: 'pnpm', hint: detected === 'pnpm' ? 'detected' : '' },
			{ value: 'yarn', label: 'yarn', hint: detected === 'yarn' ? 'detected' : '' },
			{ value: 'npm', label: 'npm', hint: detected === 'npm' ? 'detected' : '' }
		],
		initialValue: detected
	})
	if (isCancel(pm)) {
		cancel('Cancelled')
		process.exit(0)
	}

	// Auto install
	const autoInstall = await confirm({
		message: 'Install dependencies?',
		initialValue: true
	})
	if (isCancel(autoInstall)) {
		cancel('Cancelled')
		process.exit(0)
	}

	// ── Scaffold ──────────────────────────────────────────────────────────────
	const s = spinner()
	s.start('Creating project...')

	const root = join(process.cwd(), projectName)
	const srcDir = join(root, 'src')

	mkdirSync(srcDir, { recursive: true })

	writeFileSync(join(root, 'package.json'), packageJson(projectName, useTs, pm as string))
	writeFileSync(join(root, '.gitignore'), gitignore())

	if (useTs) {
		writeFileSync(join(root, 'tsconfig.json'), tsConfig(pm as string))
		writeFileSync(join(srcDir, 'index.ts'), indexFile())
	} else {
		writeFileSync(join(srcDir, 'index.js'), indexFile())
	}

	s.stop('Project created!')

	// ── Install ───────────────────────────────────────────────────────────────
	if (autoInstall) {
		const si = spinner()
		si.start(`Installing dependencies with ${pm}...`)
		const result = spawnSync(installCmd(pm as string), {
			cwd: root,
			shell: true,
			stdio: 'pipe'
		})
		if (result.status !== 0) {
			si.stop('Install failed — run manually')
			log.warn(result.stderr?.toString() ?? 'Unknown error')
		} else {
			si.stop('Dependencies installed!')
		}
	}

	outro('Ready! Happy coding 🚀')
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
