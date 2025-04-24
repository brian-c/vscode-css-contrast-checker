import postcssColorMix from '@csstools/postcss-color-mix-function';
import Color from 'colorjs.io';
import shorthandParser from 'css-shorthand-parser';
import postcss from 'postcss';

const COMMENT_PATTERN = /@bg\s*(.+)/i;
const VAR_PATTERN = /var\(\s*(.+)\s*\)/i;
const VAR_VALUES_PATTERN = /([^,]+),?(.*)*/;
const BACKGROUND_PROPERTY_PATTERN = /^background(-color)?$/i;

export async function extractColorDeclarations(cssText: string, rootRules: postcss.Rule[]) {
	try {
		const cssRoot = postcss.parse(cssText);

		const commentBackgrounds = new Map<number, string>();

		cssRoot.walkComments((comment) => {
			const { start, end } = comment.source ?? {};
			if (start === undefined || end === undefined) return;
			if (start.line !== end.line) return;
			const match = comment.text.match(COMMENT_PATTERN)?.[1]?.trim();
			try {
				if (match && (match.match(VAR_PATTERN) || new Color(match))) {
					commentBackgrounds.set(start.line, match);
				}
			} catch (error) {
				if (!isInvalidColorError(error)) throw error;
			}
		});

		const fileRootRules: postcss.Rule[] = [];
		const colors: postcss.Declaration[] = [];

		cssRoot.walkRules((rule) => {
			if (rule.selector === ':root') {
				fileRootRules.push(rule);
			}

			rule.walkDecls((declaration) => {
				if (declaration.prop.toLowerCase() === 'color') {
					colors.push(declaration);
				}
			});
		});

		const allRootRules = [...fileRootRules, ...rootRules];

		const colorMapEntries = colors.map(async (declaration) => {
			try {
				const resolvedColorValue = (await resolveColorDeclaration(declaration, allRootRules)).value;
				const color = resolvedColorValue && new Color(resolvedColorValue).toString({ format: 'hex' });
				let backgroundValue = commentBackgrounds.get(Number(declaration.source?.end?.line));
				backgroundValue ??= getClosest(declaration, BACKGROUND_PROPERTY_PATTERN)?.value;
				const parsed = backgroundValue && shorthandParser('background', backgroundValue);
				if (parsed?.['background-color']) backgroundValue = parsed['background-color'];
				const backgroundDeclaration = backgroundValue && declaration.clone({ value: backgroundValue });
				const resolvedBackgroundValue = backgroundDeclaration && (await resolveColorDeclaration(backgroundDeclaration, allRootRules)).value;
				const background = resolvedBackgroundValue && new Color(resolvedBackgroundValue).toString({ format: 'hex' });
				if (!color || !background) return;
				return { declaration, color, background } as const;
			} catch (error) {
				if (!isInvalidColorError(error)) throw error;
				return;
			}
		});

		return (await Promise.all(colorMapEntries)).filter(entry => entry !== undefined);
	} catch (error) {
		if (!(error instanceof postcss.CssSyntaxError)) throw error;
	}

	return [];
}

function isInvalidColorError(error: unknown) {
	return error instanceof Error
		&& error.message.startsWith('Could not parse')
		&& error.message.includes('as a color');
}

async function resolveColorDeclaration(
	declaration: postcss.Declaration,
	rootRules: postcss.Rule[],
): Promise<postcss.Declaration> {
	const isColorMix = declaration.value.startsWith('color-mix(');
	if (isColorMix) {
		const { default: replaceAsync } = await import('string-replace-async');
		const newValue = await replaceAsync(declaration.value, VAR_PATTERN, async (varName) => {
			const declarationClone = declaration.clone({ value: `var(${varName})` });
			return (await resolveColorDeclaration(declarationClone, rootRules))?.value ?? 'NOT_RESOLVABLE';
		});
		return declaration.clone({ value: await parseColorWithPostcss(newValue) });
	}

	const varValues = declaration.value.match(VAR_PATTERN)?.[1]?.match(VAR_VALUES_PATTERN);
	if (varValues) {
		const [varName, fallback] = varValues.slice(1, 3);
		if (!varName) return declaration;

		let value = getClosest(declaration, varName);
		if (!value) {
			for (const rule of rootRules) {
				value ??= getLastDeclaration(rule, varName);
			}
		}

		if (value) {
			return resolveColorDeclaration(value, rootRules);
		} else if (fallback) {
			const fallbackDeclaration = declaration.clone({ value: fallback });
			return resolveColorDeclaration(fallbackDeclaration, rootRules);
		}
	}

	return declaration;
}

function getClosest(node: postcss.Node, property: RegExp | string) {
	let parent = node.parent;
	let result: postcss.Declaration | undefined;
	while (parent && !result) {
		const parentIsNotADocument = parent.parent;
		if (parentIsNotADocument) result = getLastDeclaration(parent, property);
		parent = parent.parent;
	}
	return result;
}

function getLastDeclaration(rule: postcss.Container, property: RegExp | string) {
	let result: postcss.Declaration | undefined;
	rule.walkDecls(property, (declaration) => {
		if (declaration.parent === rule) result = declaration;
	});
	return result;
}

const postcssWithColorMix = postcss([postcssColorMix()]);
async function parseColorWithPostcss(color: string) {
	const wrap = ['span{color:', ';}'] as const;
	const result = await postcssWithColorMix.process(`${wrap[0]}${color}${wrap[1]}`, { from: undefined });
	return result.css.slice(wrap[0].length, wrap[1].length * -1);
}
