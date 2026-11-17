# Third-party dependency and licence register

Required by the project licensing policy and by ADR 0024. The application is
licensed MIT and offered on the Mac App Store, so nothing copyleft may ship;
where a package offers a choice (`MIT OR GPL-3.0-or-later`), it is used under
the permissive licence.

**GENERATED FILE** — regenerate with `npm run licences`.

Generated 2026-11-17 from the installed dependency tree
on Node v26.13.0. Packages examined: **673**. Copyleft or unknown: **0**.

## Licence distribution

| Licence | Packages |
| --- | --- |
| MIT | 500 |
| ISC | 94 |
| Apache-2.0 | 28 |
| BSD-2-Clause | 13 |
| BSD-3-Clause | 13 |
| BlueOak-1.0.0 | 10 |
| MPL-2.0 | 2 |
| (BSD-2-Clause OR MIT OR Apache-2.0) | 1 |
| (MIT AND Zlib) | 1 |
| (MIT OR CC0-1.0) | 1 |
| (MIT OR GPL-3.0-or-later) | 1 |
| (WTFPL OR MIT) | 1 |
| 0BSD | 1 |
| Apache 2.0 | 1 |
| Artistic-2.0 | 1 |
| CC-BY-3.0 | 1 |
| CC-BY-4.0 | 1 |
| CC0-1.0 | 1 |
| WTFPL | 1 |
| WTFPL OR ISC | 1 |

## Shipped in the application bundle

Distributed to users, so these licences bind the combined work.

| Package | Version | Licence |
| --- | --- | --- |
| `better-sqlite3` | 13.0.3 | MIT |
| `drizzle-orm` | 0.45.4 | Apache-2.0 |
| `electron` | 45.2.3 | MIT |
| `fast-xml-parser` | 5.12.0 | MIT |
| `fit-file-parser` | 6.2.7 | MIT |
| `jszip` | 3.10.2 | (MIT OR GPL-3.0-or-later) |
| `leaflet` | 1.9.4 | BSD-2-Clause |
| `lucide-react` | 1.72.0 | ISC |
| `react` | 19.3.1 | MIT |
| `react-dom` | 19.3.1 | MIT |
| `zod` | 4.6.7 | MIT |
| `zustand` | 5.0.16 | MIT |
| Chromium | bundled with Electron | BSD-3-Clause and others |
| Node.js | bundled with Electron | MIT |

## Rejected on licence grounds

| Package | Licence | Reason | Replacement |
| --- | --- | --- | --- |
| `react-leaflet` | Hippocratic-2.1 | Field-of-use restrictions and an indemnity obligation; not OSI-approved open source | Leaflet used directly, ADR 0008 |
| `@garmin/fitsdk` | Proprietary FIT Protocol License Agreement | Bilateral EULA restricting redistribution; not open source | `fit-file-parser` (MIT), ADR 0006 |

## Full dependency list

<details>
<summary>All 673 packages</summary>

| Package | Version | Licence |
| --- | --- | --- |
| `@actions/core` | 3.0.1 | MIT |
| `@actions/exec` | 3.0.0 | MIT |
| `@actions/http-client` | 4.0.1 | MIT |
| `@actions/io` | 3.0.2 | MIT |
| `@babel/code-frame` | 7.29.7 | MIT |
| `@babel/compat-data` | 7.29.7 | MIT |
| `@babel/core` | 7.29.13 | MIT |
| `@babel/generator` | 7.29.13 | MIT |
| `@babel/helper-compilation-targets` | 7.29.13 | MIT |
| `@babel/helper-globals` | 7.29.7 | MIT |
| `@babel/helper-module-imports` | 7.29.7 | MIT |
| `@babel/helper-module-transforms` | 7.29.13 | MIT |
| `@babel/helper-plugin-utils` | 7.29.7 | MIT |
| `@babel/helper-string-parser` | 7.29.13 | MIT |
| `@babel/helper-validator-identifier` | 7.29.7 | MIT |
| `@babel/helper-validator-option` | 7.29.7 | MIT |
| `@babel/helpers` | 7.29.13 | MIT |
| `@babel/parser` | 7.29.13 | MIT |
| `@babel/plugin-transform-arrow-functions` | 7.29.7 | MIT |
| `@babel/template` | 7.29.7 | MIT |
| `@babel/traverse` | 7.29.13 | MIT |
| `@babel/types` | 7.29.11 | MIT |
| `@bcoe/v8-coverage` | 1.0.2 | MIT |
| `@colors/colors` | 1.5.0 | MIT |
| `@drizzle-team/brocli` | 0.10.2 | Apache-2.0 |
| `@electron-internal/extract-zip` | 1.0.8 | MIT |
| `@electron/asar` | 3.4.1 | MIT |
| `@electron/fuses` | 1.8.0 | MIT |
| `@electron/get` | 3.1.0 | MIT |
| `@electron/notarize` | 2.5.0 | MIT |
| `@electron/osx-sign` | 1.3.3 | BSD-2-Clause |
| `@electron/rebuild` | 4.2.1 | MIT |
| `@electron/universal` | 2.0.3 | MIT |
| `@electron/windows-sign` | 1.2.2 | BSD-2-Clause |
| `@emnapi/core` | 1.11.3 | MIT |
| `@emnapi/runtime` | 1.11.3 | MIT |
| `@emnapi/wasi-threads` | 1.2.3 | MIT |
| `@esbuild-kit/core-utils` | 3.3.2 | MIT |
| `@esbuild-kit/esm-loader` | 2.6.5 | MIT |
| `@esbuild/darwin-arm64` | 0.25.12 | MIT |
| `@gar/promise-retry` | 1.0.3 | MIT |
| `@isaacs/fs-minipass` | 4.0.1 | ISC |
| `@isaacs/string-locale-compare` | 1.1.0 | ISC |
| `@jridgewell/gen-mapping` | 0.3.13 | MIT |
| `@jridgewell/remapping` | 2.3.5 | MIT |
| `@jridgewell/resolve-uri` | 3.1.2 | MIT |
| `@jridgewell/sourcemap-codec` | 1.6.0 | MIT |
| `@jridgewell/trace-mapping` | 0.3.31 | MIT |
| `@just-ak/kiro-spec-handbook` | 0.5.0 | MIT |
| `@malept/cross-spawn-promise` | 2.0.0 | Apache-2.0 |
| `@malept/flatpak-bundler` | 0.4.0 | MIT |
| `@napi-rs/wasm-runtime` | 1.2.2 | MIT |
| `@noble/hashes` | 1.8.0 | MIT |
| `@nodable/entities` | 3.1.0 | MIT |
| `@nodelib/fs.scandir` | 2.1.5 | MIT |
| `@nodelib/fs.stat` | 2.0.5 | MIT |
| `@nodelib/fs.walk` | 1.2.8 | MIT |
| `@npmcli/agent` | 4.0.2 | ISC |
| `@npmcli/arborist` | 9.9.3 | ISC |
| `@npmcli/config` | 10.14.0 | ISC |
| `@npmcli/fs` | 5.0.0 | ISC |
| `@npmcli/git` | 7.0.2 | ISC |
| `@npmcli/installed-package-contents` | 4.0.0 | ISC |
| `@npmcli/map-workspaces` | 5.0.3 | ISC |
| `@npmcli/metavuln-calculator` | 9.0.3 | ISC |
| `@npmcli/name-from-folder` | 4.0.0 | ISC |
| `@npmcli/node-gyp` | 5.0.0 | ISC |
| `@npmcli/package-json` | 7.0.5 | ISC |
| `@npmcli/promise-spawn` | 9.0.2 | ISC |
| `@npmcli/query` | 5.0.0 | ISC |
| `@npmcli/redact` | 4.0.0 | ISC |
| `@npmcli/run-script` | 10.0.4 | ISC |
| `@octokit/auth-token` | 6.0.0 | MIT |
| `@octokit/core` | 7.0.8 | MIT |
| `@octokit/endpoint` | 11.0.5 | MIT |
| `@octokit/graphql` | 9.0.5 | MIT |
| `@octokit/openapi-types` | 28.0.0 | MIT |
| `@octokit/plugin-paginate-rest` | 15.0.0 | MIT |
| `@octokit/plugin-retry` | 8.1.1 | MIT |
| `@octokit/plugin-throttling` | 11.0.5 | MIT |
| `@octokit/request` | 10.0.16 | MIT |
| `@octokit/request-error` | 7.1.2 | MIT |
| `@octokit/types` | 18.0.0 | MIT |
| `@oxc-project/types` | 0.156.0 | MIT |
| `@oxlint/binding-darwin-arm64` | 1.91.0 | MIT |
| `@pdf-lib/standard-fonts` | 1.0.0 | MIT |
| `@pdf-lib/upng` | 1.0.1 | MIT |
| `@peculiar/asn1-schema` | 2.11.1 | MIT |
| `@peculiar/json-schema` | 1.1.12 | MIT |
| `@peculiar/utils` | 2.0.3 | MIT |
| `@peculiar/webcrypto` | 1.7.2 | MIT |
| `@playwright/test` | 1.65.0 | Apache-2.0 |
| `@pnpm/config.env-replace` | 1.1.0 | MIT |
| `@pnpm/network.ca-file` | 1.0.2 | MIT |
| `@pnpm/npm-conf` | 3.0.3 | MIT |
| `@rolldown/binding-darwin-arm64` | 1.2.16 | MIT |
| `@rolldown/pluginutils` | 1.0.1 | MIT |
| `@sec-ant/readable-stream` | 0.4.1 | MIT |
| `@semantic-release/commit-analyzer` | 13.0.1 | MIT |
| `@semantic-release/error` | 4.0.0 | MIT |
| `@semantic-release/exec` | 7.1.0 | MIT |
| `@semantic-release/github` | 12.0.11 | MIT |
| `@semantic-release/npm` | 13.2.0 | MIT |
| `@semantic-release/release-notes-generator` | 14.1.1 | MIT |
| `@sigstore/bundle` | 4.0.0 | Apache-2.0 |
| `@sigstore/core` | 3.2.1 | Apache-2.0 |
| `@sigstore/protobuf-specs` | 0.5.1 | Apache-2.0 |
| `@sigstore/sign` | 4.1.1 | Apache-2.0 |
| `@sigstore/tuf` | 4.0.2 | Apache-2.0 |
| `@sigstore/verify` | 3.1.1 | Apache-2.0 |
| `@simple-libs/stream-utils` | 1.2.0 | MIT |
| `@sindresorhus/is` | 4.6.0 | MIT |
| `@sindresorhus/merge-streams` | 2.3.0 | MIT |
| `@szmarczak/http-timer` | 4.0.6 | MIT |
| `@tailwindcss/node` | 4.3.4 | MIT |
| `@tailwindcss/oxide` | 4.3.4 | MIT |
| `@tailwindcss/oxide-darwin-arm64` | 4.3.4 | MIT |
| `@tailwindcss/oxide-wasm32-wasi` | 4.3.4 | MIT |
| `@tailwindcss/vite` | 4.3.4 | MIT |
| `@tufjs/canonical-json` | 2.0.0 | MIT |
| `@tufjs/models` | 4.1.0 | MIT |
| `@tybys/wasm-util` | 0.10.3 | MIT |
| `@types/better-sqlite3` | 9.6.0 | MIT |
| `@types/cacheable-request` | 6.0.3 | MIT |
| `@types/chai` | 5.2.3 | MIT |
| `@types/debug` | 4.1.13 | MIT |
| `@types/deep-eql` | 4.0.2 | MIT |
| `@types/estree` | 1.0.10 | MIT |
| `@types/fs-extra` | 9.0.13 | MIT |
| `@types/geojson` | 7946.0.16 | MIT |
| `@types/http-cache-semantics` | 4.2.0 | MIT |
| `@types/keyv` | 3.1.4 | MIT |
| `@types/leaflet` | 1.9.22 | MIT |
| `@types/ms` | 2.1.0 | MIT |
| `@types/node` | 24.19.2 | MIT |
| `@types/normalize-package-data` | 2.4.4 | MIT |
| `@types/react` | 19.3.0 | MIT |
| `@types/react-dom` | 19.3.0 | MIT |
| `@types/responselike` | 1.0.3 | MIT |
| `@typescript/typescript-darwin-arm64` | 7.0.2 | Apache-2.0 |
| `@vitejs/plugin-react` | 6.2.1 | MIT |
| `@vitest/coverage-v8` | 5.1.0 | MIT |
| `@vitest/istanbul-lib-coverage` | 2.1.0 | MIT |
| `@vitest/istanbul-lib-report` | 2.1.0 | MIT |
| `@vitest/mocker` | 5.1.0 | MIT |
| `@vitest/spy` | 5.1.0 | MIT |
| `@xmldom/xmldom` | 0.8.15 | MIT |
| `abbrev` | 4.0.0 | ISC |
| `agent-base` | 7.1.4 | MIT |
| `aggregate-error` | 5.1.0 | MIT |
| `ajv` | 8.20.0 | MIT |
| `ansi-escapes` | 7.3.0 | MIT |
| `ansi-regex` | 6.6.0 | MIT |
| `ansi-styles` | 3.2.1 | MIT |
| `any-promise` | 1.3.0 | MIT |
| `anynum` | 1.0.1 | MIT |
| `app-builder-lib` | 26.18.0 | MIT |
| `aproba` | 2.1.0 | ISC |
| `archy` | 1.0.0 | MIT |
| `argparse` | 1.0.10 | MIT |
| `argv-formatter` | 1.0.0 | MIT |
| `array-ify` | 1.0.0 | MIT |
| `asn1js` | 3.1.0 | BSD-3-Clause |
| `assertion-error` | 2.0.1 | MIT |
| `ast-v8-to-istanbul` | 1.0.7 | MIT |
| `async` | 3.2.6 | MIT |
| `async-exit-hook` | 2.0.1 | MIT |
| `asynckit` | 0.4.0 | MIT |
| `at-least-node` | 1.0.0 | ISC |
| `aws4` | 1.13.2 | MIT |
| `balanced-match` | 4.0.4 | MIT |
| `base64-js` | 1.5.1 | MIT |
| `baseline-browser-mapping` | 2.11.35 | Apache-2.0 |
| `before-after-hook` | 4.0.0 | Apache-2.0 |
| `better-sqlite3` | 13.0.3 | MIT |
| `bin-links` | 6.0.3 | ISC |
| `binary-extensions` | 3.1.0 | MIT |
| `bluebird` | 3.7.2 | MIT |
| `boolean` | 3.2.0 | MIT |
| `bottleneck` | 2.19.5 | MIT |
| `brace-expansion` | 5.0.12 | MIT |
| `braces` | 3.0.3 | MIT |
| `browserslist` | 4.29.5 | MIT |
| `buffer` | 6.0.3 | MIT |
| `buffer-from` | 1.1.2 | MIT |
| `builder-util` | 26.16.0 | MIT |
| `builder-util-runtime` | 9.7.0 | MIT |
| `bytestreamjs` | 2.0.1 | BSD-3-Clause |
| `cac` | 7.1.0 | MIT |
| `cacache` | 20.0.4 | ISC |
| `cacheable-lookup` | 5.0.4 | MIT |
| `cacheable-request` | 7.0.4 | MIT |
| `call-bind-apply-helpers` | 1.0.2 | MIT |
| `callsites` | 3.1.0 | MIT |
| `caniuse-lite` | 1.0.30001822 | CC-BY-4.0 |
| `chai` | 6.3.0 | MIT |
| `chalk` | 2.4.2 | MIT |
| `char-regex` | 1.0.2 | MIT |
| `chownr` | 3.0.0 | BlueOak-1.0.0 |
| `chromium-pickle-js` | 0.2.0 | MIT |
| `ci-info` | 4.4.0 | MIT |
| `cidr-regex` | 5.0.5 | BSD-2-Clause |
| `clean-stack` | 5.3.0 | MIT |
| `cli-highlight` | 2.1.11 | ISC |
| `cli-table3` | 0.6.5 | MIT |
| `cliui` | 9.0.1 | ISC |
| `clone-response` | 1.0.3 | MIT |
| `cmd-shim` | 8.0.0 | ISC |
| `color-convert` | 1.9.3 | MIT |
| `color-name` | 1.1.3 | MIT |
| `combined-stream` | 1.0.8 | MIT |
| `commander` | 9.5.0 | MIT |
| `common-ancestor-path` | 2.0.0 | BlueOak-1.0.0 |
| `compare-func` | 2.0.0 | MIT |
| `compare-version` | 0.1.2 | MIT |
| `concat-map` | 0.0.1 | MIT |
| `config-chain` | 1.1.13 | MIT |
| `content-type` | 3.1.1 | MIT |
| `conventional-changelog-angular` | 8.3.1 | ISC |
| `conventional-changelog-writer` | 8.4.0 | MIT |
| `conventional-commits-filter` | 5.0.0 | MIT |
| `conventional-commits-parser` | 6.4.0 | MIT |
| `convert-hrtime` | 5.0.0 | MIT |
| `convert-source-map` | 2.0.0 | MIT |
| `core-util-is` | 1.0.3 | MIT |
| `cosmiconfig` | 9.0.2 | MIT |
| `cross-dirname` | 0.1.0 | MIT |
| `cross-spawn` | 7.0.6 | MIT |
| `crypto-random-string` | 4.0.0 | MIT |
| `cssesc` | 3.0.0 | MIT |
| `csstype` | 3.2.3 | MIT |
| `debug` | 4.4.3 | MIT |
| `decompress-response` | 6.0.0 | MIT |
| `deep-extend` | 0.6.0 | MIT |
| `defer-to-connect` | 2.0.1 | MIT |
| `define-data-property` | 1.1.4 | MIT |
| `define-properties` | 1.2.1 | MIT |
| `delayed-stream` | 1.0.0 | MIT |
| `detect-libc` | 2.1.2 | Apache-2.0 |
| `detect-node` | 2.1.0 | MIT |
| `diff` | 8.0.4 | BSD-3-Clause |
| `dir-compare` | 4.2.0 | MIT |
| `dir-glob` | 3.0.1 | MIT |
| `dmg-builder` | 26.18.0 | MIT |
| `dot-prop` | 5.3.0 | MIT |
| `dotenv` | 16.6.1 | BSD-2-Clause |
| `dotenv-expand` | 11.0.7 | BSD-2-Clause |
| `drizzle-kit` | 0.31.11 | MIT |
| `drizzle-orm` | 0.45.4 | Apache-2.0 |
| `dunder-proto` | 1.0.1 | MIT |
| `duplexer2` | 0.1.4 | BSD-3-Clause |
| `ejs` | 3.1.10 | Apache-2.0 |
| `electron` | 45.2.3 | MIT |
| `electron-builder` | 26.18.0 | MIT |
| `electron-builder-squirrel-windows` | 26.18.0 | MIT |
| `electron-publish` | 26.18.0 | MIT |
| `electron-to-chromium` | 1.5.477 | ISC |
| `electron-vite` | 6.0.0 | MIT |
| `electron-winstaller` | 5.4.0 | MIT |
| `emoji-regex` | 10.6.0 | MIT |
| `emojilib` | 2.4.0 | MIT |
| `end-of-stream` | 1.4.5 | MIT |
| `enhanced-resolve` | 5.26.1 | MIT |
| `env-ci` | 11.2.0 | MIT |
| `env-paths` | 2.2.1 | MIT |
| `environment` | 1.1.0 | MIT |
| `err-code` | 2.0.3 | MIT |
| `error-ex` | 1.3.4 | MIT |
| `es-define-property` | 1.0.1 | MIT |
| `es-errors` | 1.3.0 | MIT |
| `es-module-lexer` | 2.3.2 | MIT |
| `es-object-atoms` | 1.1.2 | MIT |
| `es-set-tostringtag` | 2.1.0 | MIT |
| `es6-error` | 4.1.1 | MIT |
| `esbuild` | 0.28.2 | MIT |
| `escalade` | 3.2.0 | MIT |
| `escape-string-regexp` | 1.0.5 | MIT |
| `esprima` | 4.0.1 | BSD-2-Clause |
| `estree-walker` | 3.0.3 | MIT |
| `execa` | 9.6.1 | MIT |
| `expect-type` | 1.4.0 | Apache-2.0 |
| `exponential-backoff` | 3.1.3 | Apache-2.0 |
| `extend-shallow` | 2.0.1 | MIT |
| `fast-deep-equal` | 3.1.3 | MIT |
| `fast-glob` | 3.3.3 | MIT |
| `fast-uri` | 3.1.9 | BSD-3-Clause |
| `fast-xml-builder` | 1.3.1 | MIT |
| `fast-xml-parser` | 5.12.0 | MIT |
| `fastest-levenshtein` | 1.0.16 | MIT |
| `fastq` | 1.20.3 | ISC |
| `fdir` | 6.5.0 | MIT |
| `figures` | 2.0.0 | MIT |
| `filelist` | 1.0.6 | Apache-2.0 |
| `fill-range` | 7.1.1 | MIT |
| `find-up` | 2.1.0 | MIT |
| `find-up-simple` | 1.0.1 | MIT |
| `find-versions` | 6.0.0 | MIT |
| `fit-file-parser` | 6.2.7 | MIT |
| `form-data` | 4.0.6 | MIT |
| `fs-extra` | 11.3.1 | MIT |
| `fs-minipass` | 3.0.3 | ISC |
| `fs.realpath` | 1.0.0 | ISC |
| `fsevents` | 2.3.3 | MIT |
| `function-bind` | 1.1.2 | MIT |
| `function-timeout` | 1.0.2 | MIT |
| `gensync` | 1.0.0-beta.2 | MIT |
| `get-caller-file` | 2.0.5 | ISC |
| `get-east-asian-width` | 1.7.0 | MIT |
| `get-intrinsic` | 1.3.0 | MIT |
| `get-proto` | 1.0.1 | MIT |
| `get-stream` | 6.0.1 | MIT |
| `get-tsconfig` | 4.14.3 | MIT |
| `git-log-parser` | 1.2.1 | MIT |
| `glob` | 13.0.6 | BlueOak-1.0.0 |
| `glob-parent` | 5.1.2 | ISC |
| `global-agent` | 3.0.0 | BSD-3-Clause |
| `globalthis` | 1.0.4 | MIT |
| `globby` | 14.1.0 | MIT |
| `gopd` | 1.2.0 | MIT |
| `got` | 11.8.6 | MIT |
| `graceful-fs` | 4.2.11 | ISC |
| `gray-matter` | 4.0.3 | MIT |
| `handlebars` | 4.7.10 | MIT |
| `has-flag` | 3.0.0 | MIT |
| `has-property-descriptors` | 1.0.2 | MIT |
| `has-symbols` | 1.1.0 | MIT |
| `has-tostringtag` | 1.0.2 | MIT |
| `hasown` | 2.0.4 | MIT |
| `highlight.js` | 10.7.3 | BSD-3-Clause |
| `hook-std` | 4.0.0 | MIT |
| `hosted-git-info` | 9.0.3 | ISC |
| `http-cache-semantics` | 4.3.0 | BSD-2-Clause |
| `http-proxy-agent` | 7.0.2 | MIT |
| `http2-wrapper` | 1.0.3 | MIT |
| `https-proxy-agent` | 7.0.6 | MIT |
| `human-signals` | 8.0.1 | Apache-2.0 |
| `iconv-lite` | 0.7.2 | MIT |
| `ieee754` | 1.2.1 | BSD-3-Clause |
| `ignore` | 7.0.14 | MIT |
| `ignore-walk` | 8.0.0 | ISC |
| `immediate` | 3.0.6 | MIT |
| `import-fresh` | 3.3.1 | MIT |
| `import-from-esm` | 2.0.0 | MIT |
| `import-meta-resolve` | 4.2.0 | MIT |
| `indent-string` | 5.0.0 | MIT |
| `index-to-position` | 1.2.0 | MIT |
| `inflight` | 1.0.6 | ISC |
| `inherits` | 2.0.4 | ISC |
| `ini` | 6.0.0 | ISC |
| `init-package-json` | 8.2.5 | ISC |
| `ip-address` | 10.7.5 | MIT |
| `is-arrayish` | 0.2.1 | MIT |
| `is-cidr` | 6.0.4 | BSD-2-Clause |
| `is-extendable` | 0.1.1 | MIT |
| `is-extglob` | 2.1.1 | MIT |
| `is-fullwidth-code-point` | 3.0.0 | MIT |
| `is-glob` | 4.0.3 | MIT |
| `is-number` | 7.0.0 | MIT |
| `is-obj` | 2.0.0 | MIT |
| `is-plain-obj` | 4.1.0 | MIT |
| `is-stream` | 3.0.0 | MIT |
| `is-unicode-supported` | 2.1.0 | MIT |
| `is-unsafe` | 2.0.3 | MIT |
| `isarray` | 1.0.0 | MIT |
| `isbinaryfile` | 5.0.7 | MIT |
| `isexe` | 4.0.0 | BlueOak-1.0.0 |
| `issue-parser` | 7.0.2 | MIT |
| `jake` | 10.9.4 | Apache-2.0 |
| `java-properties` | 1.0.2 | MIT |
| `jiti` | 2.7.0 | MIT |
| `js-tokens` | 10.0.0 | MIT |
| `js-yaml` | 4.3.2 | MIT |
| `jsesc` | 3.1.0 | MIT |
| `json-buffer` | 3.0.1 | MIT |
| `json-parse-better-errors` | 1.0.2 | MIT |
| `json-parse-even-better-errors` | 5.0.0 | MIT |
| `json-schema-traverse` | 1.0.0 | MIT |
| `json-stringify-nice` | 1.1.4 | ISC |
| `json-stringify-safe` | 5.0.1 | ISC |
| `json-with-bigint` | 3.5.12 | MIT |
| `json5` | 2.2.3 | MIT |
| `jsonfile` | 6.2.1 | MIT |
| `jsonparse` | 1.3.1 | MIT |
| `jszip` | 3.10.2 | (MIT OR GPL-3.0-or-later) |
| `just-diff` | 6.0.2 | MIT |
| `just-diff-apply` | 5.5.0 | MIT |
| `keyv` | 4.5.4 | MIT |
| `kind-of` | 6.0.3 | MIT |
| `lazy-val` | 1.0.5 | MIT |
| `leaflet` | 1.9.4 | BSD-2-Clause |
| `libnpmaccess` | 10.0.3 | ISC |
| `libnpmdiff` | 8.1.14 | ISC |
| `libnpmexec` | 10.3.5 | ISC |
| `libnpmfund` | 7.0.28 | ISC |
| `libnpmorg` | 8.0.1 | ISC |
| `libnpmpack` | 9.1.15 | ISC |
| `libnpmpublish` | 11.2.1 | ISC |
| `libnpmsearch` | 9.0.1 | ISC |
| `libnpmteam` | 8.0.2 | ISC |
| `libnpmversion` | 8.0.4 | ISC |
| `lie` | 3.3.0 | MIT |
| `lightningcss` | 1.33.0 | MPL-2.0 |
| `lightningcss-darwin-arm64` | 1.33.0 | MPL-2.0 |
| `lines-and-columns` | 1.2.4 | MIT |
| `load-json-file` | 4.0.0 | MIT |
| `locate-path` | 2.0.0 | MIT |
| `lodash` | 4.18.1 | MIT |
| `lodash-es` | 4.18.1 | MIT |
| `lodash.capitalize` | 4.2.1 | MIT |
| `lodash.escaperegexp` | 4.1.2 | MIT |
| `lodash.isplainobject` | 4.0.6 | MIT |
| `lodash.isstring` | 4.0.1 | MIT |
| `lodash.uniqby` | 4.7.0 | MIT |
| `lowercase-keys` | 2.0.0 | MIT |
| `lru-cache` | 11.5.3 | BlueOak-1.0.0 |
| `lucide-react` | 1.72.0 | ISC |
| `magic-string` | 1.4.5 | MIT |
| `magicast` | 0.5.5 | MIT |
| `make-asynchronous` | 1.1.0 | MIT |
| `make-fetch-happen` | 15.0.6 | ISC |
| `marked` | 15.0.12 | MIT |
| `marked-terminal` | 7.3.1 | MIT |
| `matcher` | 3.0.0 | MIT |
| `math-intrinsics` | 1.1.0 | MIT |
| `meow` | 13.2.0 | MIT |
| `merge-stream` | 2.0.0 | MIT |
| `merge2` | 1.4.1 | MIT |
| `micromatch` | 4.0.8 | MIT |
| `mime` | 2.6.0 | MIT |
| `mime-db` | 1.52.0 | MIT |
| `mime-types` | 2.1.35 | MIT |
| `mimic-fn` | 4.0.0 | MIT |
| `mimic-response` | 1.0.1 | MIT |
| `minimatch` | 10.2.5 | BlueOak-1.0.0 |
| `minimist` | 1.2.8 | MIT |
| `minipass` | 3.3.6 | ISC |
| `minipass-collect` | 2.0.1 | ISC |
| `minipass-fetch` | 5.0.2 | MIT |
| `minipass-flush` | 1.0.6 | BlueOak-1.0.0 |
| `minipass-pipeline` | 1.2.4 | ISC |
| `minipass-sized` | 2.0.0 | ISC |
| `minizlib` | 3.1.0 | MIT |
| `mkdirp` | 0.5.6 | MIT |
| `ms` | 2.1.3 | MIT |
| `mute-stream` | 3.0.0 | ISC |
| `mz` | 2.7.0 | MIT |
| `nanoid` | 3.3.20 | MIT |
| `negotiator` | 1.0.0 | MIT |
| `neo-async` | 2.6.2 | MIT |
| `nerf-dart` | 1.0.0 | MIT |
| `node-abi` | 4.40.0 | MIT |
| `node-addon-api` | 8.9.2 | MIT |
| `node-api-version` | 0.2.1 | MIT |
| `node-emoji` | 2.2.0 | MIT |
| `node-gyp` | 12.4.0 | MIT |
| `node-int64` | 0.4.0 | MIT |
| `node-releases` | 2.0.63 | MIT |
| `nopt` | 9.0.0 | ISC |
| `normalize-package-data` | 8.0.0 | BSD-2-Clause |
| `normalize-url` | 6.1.0 | MIT |
| `npm` | 11.21.2 | Artistic-2.0 |
| `npm-audit-report` | 7.0.0 | ISC |
| `npm-bundled` | 5.0.0 | ISC |
| `npm-install-checks` | 8.0.0 | BSD-2-Clause |
| `npm-normalize-package-bin` | 5.0.0 | ISC |
| `npm-package-arg` | 13.0.2 | ISC |
| `npm-packlist` | 10.0.4 | ISC |
| `npm-pick-manifest` | 11.0.3 | ISC |
| `npm-profile` | 12.0.2 | ISC |
| `npm-registry-fetch` | 19.1.1 | ISC |
| `npm-run-path` | 6.0.0 | MIT |
| `npm-user-validate` | 4.0.0 | BSD-2-Clause |
| `object-assign` | 4.1.1 | MIT |
| `object-keys` | 1.1.1 | MIT |
| `obug` | 3.0.0 | MIT |
| `once` | 1.4.0 | ISC |
| `onetime` | 6.0.0 | MIT |
| `oxlint` | 1.91.0 | MIT |
| `p-cancelable` | 2.1.1 | MIT |
| `p-each-series` | 3.0.0 | MIT |
| `p-event` | 6.0.1 | MIT |
| `p-filter` | 4.1.0 | MIT |
| `p-limit` | 1.3.0 | MIT |
| `p-locate` | 2.0.0 | MIT |
| `p-map` | 7.1.1 | MIT |
| `p-reduce` | 3.0.0 | MIT |
| `p-timeout` | 6.1.4 | MIT |
| `p-try` | 1.0.0 | MIT |
| `pacote` | 21.5.2 | ISC |
| `pako` | 1.0.11 | (MIT AND Zlib) |
| `parent-module` | 1.0.1 | MIT |
| `parse-conflict-json` | 5.0.1 | ISC |
| `parse-json` | 8.3.0 | MIT |
| `parse-ms` | 4.0.0 | MIT |
| `parse5` | 6.0.1 | MIT |
| `parse5-htmlparser2-tree-adapter` | 6.0.1 | MIT |
| `path-exists` | 3.0.0 | MIT |
| `path-expression-matcher` | 1.6.2 | MIT |
| `path-is-absolute` | 1.0.1 | MIT |
| `path-key` | 3.1.1 | MIT |
| `path-scurry` | 2.0.2 | BlueOak-1.0.0 |
| `path-type` | 6.0.0 | MIT |
| `pdf-lib` | 1.17.1 | MIT |
| `pe-library` | 0.4.1 | MIT |
| `picocolors` | 1.1.1 | ISC |
| `picomatch` | 4.0.7 | MIT |
| `pify` | 3.0.0 | MIT |
| `pkg-conf` | 2.1.0 | MIT |
| `pkijs` | 3.4.3 | BSD-3-Clause |
| `playwright` | 1.65.0 | Apache-2.0 |
| `playwright-core` | 1.65.0 | Apache-2.0 |
| `plist` | 3.1.0 | MIT |
| `postcss` | 8.5.32 | MIT |
| `postcss-selector-parser` | 7.1.6 | MIT |
| `postject` | 1.0.0-alpha.6 | MIT |
| `pretty-ms` | 9.3.1 | MIT |
| `proc-log` | 6.1.0 | ISC |
| `process-nextick-args` | 2.0.1 | MIT |
| `proggy` | 4.0.0 | ISC |
| `progress` | 2.0.3 | MIT |
| `promise-all-reject-late` | 1.0.1 | ISC |
| `promise-call-limit` | 3.0.2 | ISC |
| `promise-retry` | 2.0.1 | MIT |
| `promzard` | 3.0.1 | ISC |
| `proper-lockfile` | 4.1.2 | MIT |
| `proto-list` | 1.2.4 | ISC |
| `proxy-agent-negotiate` | 1.1.0 | MIT |
| `pump` | 3.0.4 | MIT |
| `pvtsutils` | 1.3.6 | MIT |
| `pvutils` | 1.2.0 | MIT |
| `qrcode-terminal` | 0.12.0 | Apache 2.0 |
| `queue-microtask` | 1.2.3 | MIT |
| `quick-lru` | 5.1.1 | MIT |
| `rc` | 1.2.8 | (BSD-2-Clause OR MIT OR Apache-2.0) |
| `react` | 19.3.1 | MIT |
| `react-dom` | 19.3.1 | MIT |
| `read` | 5.0.1 | ISC |
| `read-binary-file-arch` | 1.0.6 | MIT |
| `read-cmd-shim` | 6.0.0 | ISC |
| `read-package-up` | 12.0.0 | MIT |
| `read-pkg` | 10.1.0 | MIT |
| `readable-stream` | 2.3.8 | MIT |
| `registry-auth-token` | 5.1.1 | MIT |
| `require-directory` | 2.1.1 | MIT |
| `require-from-string` | 2.0.2 | MIT |
| `resedit` | 1.7.2 | MIT |
| `resolve-alpn` | 1.2.1 | MIT |
| `resolve-from` | 5.0.0 | MIT |
| `resolve-pkg-maps` | 1.0.0 | MIT |
| `responselike` | 2.0.1 | MIT |
| `retry` | 0.12.0 | MIT |
| `reusify` | 1.1.0 | MIT |
| `rimraf` | 2.6.3 | ISC |
| `roarr` | 2.15.4 | BSD-3-Clause |
| `rolldown` | 1.2.16 | MIT |
| `run-parallel` | 1.2.0 | MIT |
| `safe-buffer` | 5.1.2 | MIT |
| `safer-buffer` | 2.1.2 | MIT |
| `sanitize-filename` | 1.6.4 | WTFPL OR ISC |
| `sax` | 1.6.1 | BlueOak-1.0.0 |
| `scheduler` | 0.28.0 | MIT |
| `section-matter` | 1.0.0 | MIT |
| `semantic-release` | 25.0.9 | MIT |
| `semver` | 5.7.3 | ISC |
| `semver-compare` | 1.0.0 | MIT |
| `semver-regex` | 4.0.5 | MIT |
| `serialize-error` | 7.0.1 | MIT |
| `setimmediate` | 1.0.5 | MIT |
| `shebang-command` | 2.0.0 | MIT |
| `shebang-regex` | 3.0.0 | MIT |
| `signal-exit` | 3.0.7 | ISC |
| `signale` | 1.4.0 | MIT |
| `sigstore` | 4.1.1 | Apache-2.0 |
| `simple-update-notifier` | 2.0.0 | MIT |
| `skin-tone` | 2.0.0 | MIT |
| `slash` | 5.1.0 | MIT |
| `smart-buffer` | 4.2.0 | MIT |
| `socks` | 2.8.9 | MIT |
| `socks-proxy-agent` | 8.0.5 | MIT |
| `source-map` | 0.6.1 | BSD-3-Clause |
| `source-map-js` | 1.2.2 | BSD-3-Clause |
| `source-map-support` | 0.5.21 | MIT |
| `spawn-error-forwarder` | 1.0.0 | MIT |
| `spdx-correct` | 3.2.0 | Apache-2.0 |
| `spdx-exceptions` | 2.5.0 | CC-BY-3.0 |
| `spdx-expression-parse` | 3.0.1 | MIT |
| `spdx-license-ids` | 3.0.24 | CC0-1.0 |
| `split2` | 1.0.0 | ISC |
| `sprintf-js` | 1.1.3 | BSD-3-Clause |
| `ssri` | 13.0.1 | ISC |
| `stat-mode` | 1.0.0 | MIT |
| `std-env` | 4.3.0 | MIT |
| `stream-combiner2` | 1.1.1 | MIT |
| `string-width` | 4.2.3 | MIT |
| `string_decoder` | 1.1.1 | MIT |
| `strip-ansi` | 6.0.1 | MIT |
| `strip-bom` | 3.0.0 | MIT |
| `strip-bom-string` | 1.0.0 | MIT |
| `strip-final-newline` | 4.0.0 | MIT |
| `strip-json-comments` | 2.0.1 | MIT |
| `strnum` | 2.5.1 | MIT |
| `sumchecker` | 3.0.1 | Apache-2.0 |
| `super-regex` | 1.1.0 | MIT |
| `supports-color` | 7.2.0 | MIT |
| `supports-hyperlinks` | 3.2.0 | MIT |
| `tagged-tag` | 1.0.0 | MIT |
| `tailwindcss` | 4.3.4 | MIT |
| `tapable` | 2.3.3 | MIT |
| `tar` | 7.5.22 | BlueOak-1.0.0 |
| `temp` | 0.9.4 | MIT |
| `temp-dir` | 3.0.0 | MIT |
| `temp-file` | 3.4.0 | MIT |
| `tempy` | 3.2.0 | MIT |
| `text-table` | 0.2.0 | MIT |
| `thenify` | 3.3.1 | MIT |
| `thenify-all` | 1.6.0 | MIT |
| `through2` | 2.0.5 | MIT |
| `time-span` | 5.1.0 | MIT |
| `tiny-async-pool` | 1.3.0 | MIT |
| `tiny-relative-date` | 2.0.2 | MIT |
| `tinybench` | 6.2.3 | MIT |
| `tinyexec` | 1.3.1 | MIT |
| `tinyglobby` | 0.2.17 | MIT |
| `tinyrainbow` | 3.2.0 | MIT |
| `tmp` | 0.2.7 | MIT |
| `tmp-promise` | 3.0.3 | MIT |
| `to-regex-range` | 5.0.1 | MIT |
| `traverse` | 0.6.8 | MIT |
| `treeverse` | 3.0.0 | ISC |
| `truncate-utf8-bytes` | 1.0.2 | WTFPL |
| `tslib` | 2.9.1 | 0BSD |
| `tsx` | 4.23.15 | MIT |
| `tuf-js` | 4.1.0 | MIT |
| `tunnel` | 0.0.6 | MIT |
| `type-fest` | 0.13.1 | (MIT OR CC0-1.0) |
| `typescript` | 7.0.2 | Apache-2.0 |
| `uglify-js` | 3.19.3 | BSD-2-Clause |
| `undici` | 7.30.2 | MIT |
| `undici-types` | 8.9.0 | MIT |
| `unicode-emoji-modifier-base` | 1.0.0 | MIT |
| `unicorn-magic` | 0.3.0 | MIT |
| `unique-string` | 3.0.0 | MIT |
| `universal-user-agent` | 7.0.3 | ISC |
| `universalify` | 2.0.1 | MIT |
| `unzipper` | 0.12.5 | MIT |
| `update-browserslist-db` | 1.3.4 | MIT |
| `url-join` | 5.2.0 | MIT |
| `utf8-byte-length` | 1.0.5 | (WTFPL OR MIT) |
| `util-deprecate` | 1.0.2 | MIT |
| `validate-npm-package-license` | 3.0.4 | Apache-2.0 |
| `validate-npm-package-name` | 7.0.2 | ISC |
| `vite` | 8.3.6 | MIT |
| `vitest` | 5.1.0 | MIT |
| `walk-up-path` | 4.0.0 | ISC |
| `web-worker` | 1.5.0 | Apache-2.0 |
| `webcrypto-core` | 1.9.2 | MIT |
| `which` | 2.0.2 | ISC |
| `why-is-node-running` | 3.2.1 | MIT |
| `wordwrap` | 1.0.0 | MIT |
| `wrap-ansi` | 7.0.0 | MIT |
| `wrappy` | 1.0.2 | ISC |
| `write-file-atomic` | 7.0.1 | ISC |
| `xml-naming` | 0.3.0 | MIT |
| `xmlbuilder` | 15.1.1 | MIT |
| `xtend` | 4.0.2 | MIT |
| `y18n` | 5.0.8 | ISC |
| `yallist` | 3.1.1 | ISC |
| `yargs` | 17.7.3 | MIT |
| `yargs-parser` | 21.1.1 | ISC |
| `yocto-queue` | 0.1.0 | MIT |
| `yoctocolors` | 2.2.0 | MIT |
| `zod` | 4.6.7 | MIT |
| `zustand` | 5.0.16 | MIT |

</details>

## Native components: the embedded Valhalla routing engine

Maintained **by hand** in `docs/licences/native-and-data.md`, which
`npm run licences` appends to the generated register verbatim. These are not npm
dependencies, so the generator cannot see them — it reads the lockfile, and none
of this is in it. Edit that file, not the register; update it whenever
`VALHALLA_TAG` in `scripts/build-valhalla.sh` changes or the dependency set
moves.

Compiled into the shipped app, so all of it reaches users and must suit an MIT
app distributed through the Mac App Store: permissive, or MPL, and never GPL.
LGPL is reviewed case by case. See ADRs 0013 and 0024.

| Component | Version | Licence | Verdict |
| --- | --- | --- | --- |
| valhalla | 3.9.1 | MIT | Fine |
| boost | 1.92.0 | BSL-1.0 | Fine |
| protobuf (+ abseil) | 36.2 | BSD-3-Clause | Fine |
| sqlite | 3.53.4 | Public domain | Fine |
| libspatialite | 5.1.0 | MPL-1.1 / GPL-2.0+ / LGPL-2.1+ | **MPL-1.1 elected** (ADR 0024) |
| luajit | 2.1 | MIT | Fine |
| geos | 3.15.0 | LGPL-2.1-or-later | **Open question for the App Store build** — see below |
| lz4 | 1.11.0 | BSD-2-Clause (library) | Fine |
| libgeotiff | 1.7.4 | MIT-style | Fine |
| libtiff | 4.7.2 | libtiff (BSD-like) | Fine |
| openssl@3 | 3.6.3 | Apache-2.0 | Fine |
| expat | 2.10.0 | MIT | Fine |
| curl | 8.23.0 | curl (MIT-like) | Fine |
| proj | 9.9.0 | MIT | Fine |

### The licence elections that matter

**libspatialite** and **readosm** are tri-licensed MPL-1.1 / GPL-2.0-or-later /
LGPL-2.1-or-later. While TrailRT was GPL-3.0 we took them under LGPL, because
MPL-1.1 does not combine with GPL. TrailRT is now MIT (ADR 0024), so we take
them under **MPL-1.1**. That licence is file-level: it covers changes to their
own files only, imposes no relinking terms, and suits the App Store. We do not
modify them. The election is deliberate and must be restated if these are ever
upgraded.

**geos** is LGPL-2.1-or-later only. It is dynamically linked, which meets the
LGPL for the DMG, because a user can replace the dylib. Inside a signed App
Store bundle they cannot, and whether that meets LGPL §6 is contested. Phase 15
settles it before any store submission: either show that the shipped tools and
addon do not need geos and drop it from the closure, or get advice and record
it here.

### Bundled inside Valhalla's own source tree

Verified against each component's licence file at tag 3.9.1:

| Component | Licence |
| --- | --- |
| cpp-statsd-client, date, dirent, just_gtfs, rapidjson, unordered_dense, microtar, cxxopts, flatbush | MIT |
| libosmium | BSL-1.0 |
| protozero | BSD-2-Clause (notice file Apache-2.0) |
| vtzero | BSD-2-Clause |
| nanobind | BSD-3-Clause |
| tz | Public domain |
| googletest, fastcov | BSD-3-Clause / MIT — build and test only, not shipped |

### Bundled beside Valhalla: trailrt-osm (ADRs 0018, 0023)

`resources/valhalla/bin/trailrt-osm` merges several regions' extracts into one
before the tile build, because Valhalla aborts on overlapping extracts, and
pulls place data out of the extract for offline search. It is TrailRT's own
code (`native/trailrt-osm/`, MIT), built by
`scripts/build-osm-tool.sh` against the libraries below. A separate
executable, run as a child process. It replaced the osmium-tool executable,
which is no longer bundled or built.

| Component | Version | Licence | Verdict |
| --- | --- | --- | --- |
| libosmium (header-only, compiled in) | 2.23.1 | BSL-1.0 | Fine |
| protozero (header-only, compiled in) | 1.8.2 | BSD-2-Clause | Fine |
| expat, zlib | system | MIT / zlib | Fine — macOS system libraries, not shipped |

Nothing in these tables carries a field-of-use restriction, and nothing is
GPL. The one LGPL-only component, geos, is the open question above.

### Source availability

Valhalla is MIT, so its own terms require attribution only. The pinned tag in
`scripts/build-valhalla.sh` plus the public repository identifies exactly what
was built. TrailRT no longer owes corresponding source under GPL (ADR 0024),
but publishes it with every release anyway. While geos is bundled, its source
(version above, from <https://github.com/libgeos/geos>) is offered too, as the
LGPL requires.

## Data downloaded at runtime (ADRs 0018, 0019)

Not code, and not shipped in the app: fetched at the user's choice, cached in
their data directory, and attributed in the About window.

| Data | Source | Terms |
| --- | --- | --- |
| Road graph extracts | Geofabrik (`download.geofabrik.de`) | © OpenStreetMap contributors, ODbL 1.0 |
| UK boundary (`src/shared/geo/ukBoundary.ts`, 150 points, generated) | Geofabrik region index | © OpenStreetMap contributors, ODbL 1.0 |
| Terrain elevation tiles | Terrain Tiles, AWS Registry of Open Data (`elevation-tiles-prod.s3.amazonaws.com`) | Open data, derived from SRTM (NASA, public domain) and other sources listed at <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>. Attribution required; given in the About window |
| Place data: POIs, place and street names, addressed buildings (`places.sqlite`) | Built on the user's machine from the same Geofabrik extracts, during the region build | © OpenStreetMap contributors, ODbL 1.0. A Derivative Database used on the user's own machine and not publicly distributed, so share-alike is not triggered; attribution shown with every search result and POI list, and in the About window |
| Postcodes (`postcodes.sqlite`) | Ordnance Survey Code-Point Open (`api.os.uk`, one redirect to OS's Azure storage), fetched from Settings | Open Government Licence v3.0. Requires: "Contains OS data © Crown copyright and database right", "Contains Royal Mail data © Royal Mail copyright and database right", "Contains National Statistics data © Crown copyright and database right", with the release's year; shown beside postcode results and in the About window |

### Test fixtures with third-party data (Phase 10)

Committed to the repository, so distributed with the source.

| Fixture | Source | Terms |
| --- | --- | --- |
| `test-data/places-excerpt/` (`buxton.geojsonseq`, `tiny.osm`) | Geofabrik Derbyshire extract, data of 2026-11-08 | © OpenStreetMap contributors. Published under ODbL 1.0, as a distributed Derivative Database must be; see its README |
| `test-data/codepoint/` (279 postcodes, licence and metadata files) | Code-Point Open release 2026-11 | Open Government Licence v3.0, with the statements above; see its README |
