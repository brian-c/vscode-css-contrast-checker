import esbuild from 'esbuild';

const context = await esbuild.context({
	entryPoints: ['./src/extension.ts'],
	bundle: true,
	format: 'cjs',
	sourcemap: true,
	platform: 'node',
	outfile: './out/extension.js',
	external: ['vscode'],
});

await context.rebuild();
await context.dispose();
