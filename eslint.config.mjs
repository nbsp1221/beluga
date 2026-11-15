import { nodeConfig } from '@workspace/tooling-config/eslint';
import { globalIgnores } from 'eslint/config';

export default [...nodeConfig, globalIgnores(['apps/**', 'packages/**'])];
