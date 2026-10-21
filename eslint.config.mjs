import next from 'eslint-config-next/core-web-vitals';
export default [
  ...next,
  { ignores: ['**/.next/**', 'node_modules/**'] },
  {
    rules: { '@next/next/no-html-link-for-pages': 'off', 'react-hooks/set-state-in-effect': 'off' },
  },
];
