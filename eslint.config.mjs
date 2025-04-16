import eslint from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import 'eslint-plugin-only-warn';
import tsEslint from 'typescript-eslint';

export default tsEslint.config([
	eslint.configs.recommended,
	stylistic.configs.customize({
		indent: 'tab',
		braceStyle: '1tbs',
		semi: true,
	}),
	tsEslint.configs.strict,
	tsEslint.configs.stylistic,
]);
