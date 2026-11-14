import { reactConfig } from '@workspace/tooling-config/eslint';
import { shadcnIgnores } from '@workspace/tooling-config/ignores';
import { globalIgnores } from 'eslint/config';

export default [...reactConfig, globalIgnores(shadcnIgnores)];
