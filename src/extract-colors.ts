import Color from 'colorjs.io';
import postcss from 'postcss';
import shorthandParser from 'css-shorthand-parser';

const COMMENT_PATTERN = /@bg\s*(.+)/i;
const VAR_PATTERN = /var[(]\s*(.+)\s*[)]/i;
const VAR_VALUES_PATTERN = /([^,]+),?(.*)*/;

export function extractColorDeclarations(cssText: string, rootRules: postcss.Rule[]) {
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

		const localRootRules: postcss.Rule[] = [];
		const colors: postcss.Declaration[] = [];

		cssRoot.walkRules((rule) => {
			if (rule.selector === ':root') {
				localRootRules.push(rule);
			}

			rule.walkDecls((declaration) => {
				if (declaration.parent !== rule) return;
				if (declaration.prop.toLowerCase() === 'color') {
					colors.push(declaration);
				}
			});
		});

		const allRootRules = [...localRootRules, ...rootRules];

		const colorMapEntries = colors.map((declaration) => {
			try {
				const resolvedColorValue = resolveCustomProperty(declaration, allRootRules)?.value;
				const color = resolvedColorValue && new Color(resolvedColorValue).toString({ format: 'hex' });
				let backgroundValue = commentBackgrounds.get(Number(declaration.source?.end?.line));
				backgroundValue ??= getClosestBackground(declaration)?.value;
				const parsed = shorthandParser('background', backgroundValue);
				if (parsed['background-color']) backgroundValue = parsed['background-color'];
				const backgroundDeclaration = backgroundValue && declaration.clone({ value: backgroundValue });
				const resolvedBackgroundValue = backgroundDeclaration && resolveCustomProperty(backgroundDeclaration, localRootRules)?.value;
				const background = resolvedBackgroundValue && new Color(resolvedBackgroundValue).toString({ format: 'hex' });
				if (!color || !background) return;
				return { declaration, color, background } as const;
			} catch (error) {
				if (!isInvalidColorError(error)) throw error;
				return;
			}
		});

		return colorMapEntries.filter(entry => entry !== undefined);
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

function resolveCustomProperty(
	declaration: postcss.Declaration,
	rootRules: postcss.Rule[],
) {
	const varMatch = declaration.value.match(VAR_PATTERN);
	const varValues = varMatch?.[1]?.match(VAR_VALUES_PATTERN);

	if (varValues) {
		const [name, fallback] = varValues.slice(1, 3);

		if (!name) return;

		let rule = getClosestRule(declaration);
		let value: postcss.Declaration | undefined;

		while (rule && !value) {
			value = getRuleDeclaration(rule, name);
			rule = rule.parent && getClosestRule(rule.parent);
		}

		if (!value) {
			for (const rule of rootRules) {
				value ??= getRuleDeclaration(rule, name);
			}
		}

		if (value) {
			return value;
		} else if (fallback) {
			const fallbackDeclaration = declaration.clone({ value: fallback });
			return resolveCustomProperty(fallbackDeclaration, rootRules);
		}
	} else {
		return declaration;
	}

	return;
}

function getClosestBackground(node: postcss.Node) {
	let rule = getClosestRule(node);
	let background: postcss.Declaration | undefined;
	while (rule && !background) {
		background = getRuleDeclaration(rule, /^background(-color)?$/);
		rule = rule.parent && getClosestRule(rule.parent);
	}
	return background;
}

function getClosestRule(node: postcss.Node) {
	let parent: postcss.Node | undefined = node;
	while (parent && parent.type !== 'rule') {
		parent = node.parent;
	}
	return parent as postcss.Rule | undefined;
}

function getRuleDeclaration(rule: postcss.Rule, property: RegExp | string) {
	let result: postcss.Declaration | undefined;
	rule.walkDecls(property, (declaration) => {
		if (declaration.parent === rule) {
			// Don't `return false` to break; we want the last one.
			result = declaration;
		}
	});
	return result;
}
