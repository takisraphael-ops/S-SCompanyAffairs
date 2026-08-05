import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * eslint-config-next 16 ships native flat configs, so these are spread
 * directly — routing them through @eslint/eslintrc's FlatCompat breaks on the
 * plugin's circular self-reference.
 */
const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "src/db/migrations/**"] },
  ...coreWebVitals,
  ...typescript,
];

export default eslintConfig;
