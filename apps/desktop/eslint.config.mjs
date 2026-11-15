import { reactConfig } from '@workspace/tooling-config/eslint';
import { globalIgnores } from 'eslint/config';

export default [...reactConfig, globalIgnores(['src-tauri/target/**', 'src-tauri/gen/**'])];
