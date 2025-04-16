import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import * as vscode from 'vscode';

export default class RootRuleWatcher {
	private readonly glob = '**/*.css';

	private readonly emitter: vscode.EventEmitter<void>;
	private readonly watcher: vscode.FileSystemWatcher;

	private readonly cache = new Map<vscode.Uri['fsPath'], postcss.Rule[]>();

	constructor() {
		this.emitter = new vscode.EventEmitter();

		this.watcher = vscode.workspace.createFileSystemWatcher(this.glob);
		this.watcher.onDidCreate(uri => this.cacheFile(uri));
		this.watcher.onDidChange(uri => this.cacheFile(uri));
		this.watcher.onDidDelete(uri => this.cacheFile(uri, true));

		vscode.workspace.findFiles(this.glob).then((uris) => {
			for (const uri of uris) this.cacheFile(uri);
		});
	}

	dispose() {
		this.watcher.dispose();
	}

	addListener(...args: Parameters<typeof this.emitter['event']>) {
		return this.emitter.event(...args);
	}

	get rules() {
		return Array.from(this.cache.entries())
			.sort((entry1, entry2) => entry1[0].localeCompare(entry2[0]))
			.map(entry => entry[1])
			.flat()
			.reverse();
	}

	private async cacheFile(uri: vscode.Uri, remove = false) {
		if (remove) {
			this.cache.delete(uri.fsPath);
		} else {
			const rules = await this.findRootRules(uri);
			this.cache.set(uri.fsPath, rules);
		}

		this.emitter.fire();
	}

	private async findRootRules(uri: vscode.Uri) {
		try {
			const css = await readFile(uri.fsPath);
			const cssRoot = postcss.parse(css);

			const rootRules: postcss.Rule[] = [];

			cssRoot.walkRules((rule) => {
				if (rule.selector === ':root') rootRules.push(rule);
			});

			return rootRules;
		} catch (error) {
			if (!(error instanceof postcss.CssSyntaxError)) throw error;
		}

		return [];
	}
}
