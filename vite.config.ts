import { defineConfig } from "vite-plus";

export default defineConfig({
  defaultPackage: { dev: "./apps/web" },
  run: {
    cache: { scripts: true },
  },
  staged: {
    "*": "vp check --fix",
  },
  test: {
    projects: ["apps/*", "packages/*"],
  },
  fmt: {
    ignorePatterns: ["**/*.md"],
  },
  lint: {
    plugins: ["import", "typescript", "unicorn"],
    categories: {
      correctness: "error",
      suspicious: "warn",
      style: "warn",
    },
    rules: {
      "arrow-body-style": ["warn", "as-needed"],
      curly: ["warn", "all"],
      "prefer-template": "warn",
      "capitalized-comments": "off",
      "sort-keys": "off",
      "sort-imports": "off",
      "no-magic-numbers": "off",
      "new-cap": "off",
      "no-template-curly-in-string": "off",
      "unicorn/numeric-separators-style": "off",
      "typescript/method-signature-style": "off",
      "import/group-exports": "off",
      "import/exports-last": "off",
      "id-length": "off",
      "max-params": "off",
      "max-statements": "off",
      "no-continue": "off",
      "no-ternary": "off",
      "func-names": "off",
      "vars-on-top": "off",
      "init-declarations": "off",
      "no-inline-comments": "off",
      "one-var": "off",
      "prefer-named-capture-group": "off",
      "no-underscore-dangle": "off",
      "prefer-arrow-callback": "off",
      "unicorn/max-nested-calls": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/no-array-reverse": "off",
      eqeqeq: ["warn", "always"],
      "no-else-return": "warn",
      "no-lonely-if": "warn",
      "no-negated-condition": "warn",
      "no-var": "warn",
      "no-implicit-coercion": "warn",
      "no-duplicate-imports": "warn",
      "typescript/array-type": [
        "warn",
        {
          default: "array",
        },
      ],
      "typescript/consistent-type-definitions": ["warn", "type"],
      "typescript/consistent-type-imports": [
        "warn",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],
      "typescript/consistent-indexed-object-style": ["warn", "record"],
      "typescript/consistent-generic-constructors": ["warn", "constructor"],
      "typescript/consistent-type-assertions": [
        "warn",
        {
          assertionStyle: "as",
        },
      ],
      "typescript/prefer-includes": "warn",
      "typescript/prefer-optional-chain": "warn",
      "typescript/consistent-type-exports": "warn",
      "typescript/dot-notation": ["warn", { allowIndexSignaturePropertyAccess: true }],
      "typescript/no-unsafe-type-assertion": "off",
      "typescript/no-require-imports": "warn",
      "unicorn/no-null": "off",
      "unicorn/catch-error-name": [
        "warn",
        {
          name: "error",
        },
      ],
      "unicorn/explicit-length-check": "warn",
      "unicorn/prefer-array-some": "warn",
      "unicorn/prefer-at": "warn",
      "unicorn/prefer-date-now": "warn",
      "unicorn/prefer-regexp-test": "warn",
      "unicorn/prefer-string-replace-all": "warn",
      "unicorn/prefer-string-slice": "warn",
      "unicorn/no-array-for-each": "warn",
      "unicorn/prefer-number-properties": "warn",
      "unicorn/prefer-module": "warn",
      "import/no-default-export": "warn",
      "import/no-commonjs": "warn",
      "import/consistent-type-specifier-style": ["warn", "prefer-inline"],
      "import/prefer-default-export": "off",
      "import/no-named-export": "off",
      "import/no-namespace": "off",
      "import/no-named-as-default": "off",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      {
        files: ["apps/cli/src/**", "apps/cli/vite.config.ts", "packages/brand/src/render.tsx"],
        rules: {
          "import/no-nodejs-modules": "off",
        },
      },
      {
        files: ["**/*.d.ts"],
        rules: {
          "typescript/consistent-type-definitions": "off",
        },
      },
      {
        files: ["apps/web/src/globals.d.ts"],
        rules: {
          "no-var": "off",
        },
      },
      {
        files: ["packages/core/src/manifest.ts"],
        rules: {
          "unicorn/no-thenable": "off",
        },
      },
      {
        files: ["apps/web/src/test-setup.ts", "apps/web/src/main.tsx"],
        rules: {
          "import/no-unassigned-import": "off",
        },
      },
      {
        files: ["**/vite.config.*", "**/vitest.config.*"],
        rules: {
          "import/no-default-export": "off",
          "import/no-anonymous-default-export": "off",
        },
      },
    ],
    settings: {
      vitest: {
        typecheck: false,
      },
    },
    env: {
      builtin: true,
    },
    ignorePatterns: [],
    options: {
      denyWarnings: true,
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
});
