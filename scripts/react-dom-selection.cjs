// Audited build-time adaptation. Never edit node_modules or discard React's
// fallback. A dependency upgrade must explicitly re-audit this integration.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');

const auditedVersion = '19.3.1';
const auditedSHA256 = 'a319b413b7a19ee34422d9a12a8e7afd003c07846716d278ba1a0898e8cb6251';
const helperPath = path.resolve(__dirname, '../src/lib/native-selection-offsets.ts');
const captureStart = 'function commitBeforeMutationEffects(root, firstChild, committedLanes) {';
const traversalStart = '          var length = 0,';
const insertion = `          var vulgarNativeOffsets = vulgarNativeSelectionOffsets(root, JSCompiler_temp, anchorOffset, focusNode, selection);
          if (vulgarNativeOffsets !== null) {
            JSCompiler_temp = vulgarNativeOffsets;
            break a;
          }
`;

function patchReactDOMSelection(source, version) {
  const sha256 = createHash('sha256').update(source).digest('hex');
  if (version !== auditedVersion || sha256 !== auditedSHA256) {
    throw new Error(`React DOM selection adaptation requires a new audit: expected ${auditedVersion} (${auditedSHA256}), received ${version} (${sha256}). See scripts/react-dom-selection.cjs.`);
  }
  const capture = source.indexOf(captureStart);
  const offset = source.indexOf(traversalStart, capture);
  if (capture < 0 || offset < 0 || source.indexOf(captureStart, capture + 1) >= 0) {
    throw new Error('The audited React DOM selection capture was not found exactly once.');
  }
  const patched = source.slice(0, offset) + insertion + source.slice(offset);
  // Keep the license and the strict-mode directive in place. esbuild resolves
  // this helper as a normal module; only the bundled app contains the change.
  return patched.replace('"use strict";', '"use strict";\nvar vulgarNativeSelectionOffsets = require(' + JSON.stringify(helperPath) + ').nativeSelectionOffsets;');
}

function reactDOMSelectionPlugin() {
  return {
    name: 'audited-react-dom-selection',
    setup(build) {
      build.onLoad({filter: /[\\/]react-dom[\\/]cjs[\\/]react-dom-client\.production\.js$/}, args => {
        const source = fs.readFileSync(args.path, 'utf8');
        const {version} = JSON.parse(fs.readFileSync(path.resolve(path.dirname(args.path), '../package.json'), 'utf8'));
        return {contents: patchReactDOMSelection(source, version), loader: 'js', resolveDir: path.dirname(args.path)};
      });
    },
  };
}

module.exports = {reactDOMSelectionPlugin, patchReactDOMSelection, auditedVersion, auditedSHA256};
