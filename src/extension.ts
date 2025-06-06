import Color from 'colorjs.io';
import * as vscode from 'vscode';
import { extractColorDeclarations } from './extract-colors';
import RootRuleWatcher from './root-rule-watcher';

const failColor = new vscode.ThemeColor('errorForeground');
const passColor = new vscode.ThemeColor('descriptionForeground');

export function activate(context: vscode.ExtensionContext) {
	const instance = new CssColorContrast();
	context.subscriptions.push(instance);
}

class CssColorContrast {
	#rootRuleWatcher: RootRuleWatcher;
	#disposable: vscode.Disposable;

	decorationType = vscode.window.createTextEditorDecorationType({
		rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
	});

	constructor() {
		this.#rootRuleWatcher = new RootRuleWatcher();

		const stopListening = this.#rootRuleWatcher.addListener(() => this.updateDecorations());

		const ignoreSwitchingTabs = vscode.window.onDidChangeActiveTextEditor(() => {
			this.updateDecorations();
		});

		const ignoreChanges = vscode.workspace.onDidChangeTextDocument((event) => {
			const isActiveDocument = event.document === vscode.window.activeTextEditor?.document;
			if (isActiveDocument) this.updateDecorations();
		});

		this.#disposable = vscode.Disposable.from(
			stopListening,
			ignoreSwitchingTabs,
			ignoreChanges,
		);
	}

	dispose() {
		this.#rootRuleWatcher.dispose();
		this.#disposable.dispose();
	}

	get minimumContrast() {
		const setting = vscode.workspace.getConfiguration('cssContrastHints').get<'aa' | 'aaa' | number>('minimumContrast');
		const value = setting === 'aa' ? 4.5 : setting === 'aaa' ? 7 : setting ?? NaN;
		return { setting, value } as const;
	}

	async updateDecorations() {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'css') return;

		const text = editor.document.getText();
		const colorDeclarations = await extractColorDeclarations(text, this.#rootRuleWatcher.rules);

		const decorations = colorDeclarations.map(({ declaration, color, background }) => {
			if (!color || !background) return;
			const foreground = new Color(color);
			const flattened = foreground.mix(background, 1 - foreground.alpha);
			const contrast = flattened.contrast(background, 'WCAG21');
			const passes = contrast >= this.minimumContrast.value;

			const matchStart = declaration.source?.start?.offset;
			const matchEnd = declaration.source?.end?.offset;
			if (matchStart === undefined || matchEnd === undefined) return;

			const startPosition = editor.document.positionAt(matchStart);
			const endPosition = editor.document.positionAt(matchEnd);

			return {
				range: new vscode.Range(startPosition, endPosition),
				renderOptions: {
					after: {
						contentText: [
							passes ? '◐' : '🚫',
							`${contrast.toFixed(2)}`,
						].join(' '),
						color: passes ? passColor : failColor,
						margin: '0 1ch',
					},
				},
				hoverMessage: this.createHoverMessage(color, background, contrast, passes),
			} as vscode.DecorationOptions;
		}).filter(decoration => decoration !== undefined);

		editor.setDecorations(this.decorationType, decorations);
	}

	createHoverMessage(
		color: string,
		background: string,
		contrast: number,
		passes: boolean,
	) {
		const wcag = this.minimumContrast.setting === 'aa' ? 'WCAG AA' : this.minimumContrast.setting === 'aaa' ? 'WCAG AAA' : null;
		const message = new vscode.MarkdownString([
			`\`${color}\` : \`${background}\` → ${parseFloat(contrast.toFixed(2)).toLocaleString()}:1`,
			// Whitespace and order matter on this style string:
			`<span style="color:${color};background-color:${background};">&nbsp;For example, lorem ipsum dolor sit amet&nbsp;</span>`,
			`<small>${passes ? '✅ Meets' : '❌ Fails'} ${wcag ? `${wcag} (minimum ${this.minimumContrast.value}:1)` : `minimum ${this.minimumContrast.value}:1`}</small>`,
		].join('  \n'));
		message.supportHtml = true;
		return message;
	}
}
