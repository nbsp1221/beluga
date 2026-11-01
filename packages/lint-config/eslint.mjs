import retn0 from '@retn0/eslint-config';
import eslintConfigOxlint from '@retn0/eslint-config-oxlint';
import oxlintConfig from './oxlint.mts';

export default retn0({ environments: ['node'] }, eslintConfigOxlint(oxlintConfig));
