module.exports = {
  env: {
    es2021: true,
    node: true,
  },
  extends: ['airbnb-base', 'prettier'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    "import/extensions": [
      "error",
      "ignorePackages",
      {
        js: "never",
        jsx: "never",
        ts: "never",
        tsx: "never"
      }
    ],
    'no-console' : "off", // コンソールは別にいいや
    camelcase: "off" // キャメルケース反対運動。
  },
  settings: {
    'import/resolver': {
      node: {
        paths: ["src"],
        extensions: [".js", ".jsx", ".ts", ".tsx"]
      }
    }
  }
};
