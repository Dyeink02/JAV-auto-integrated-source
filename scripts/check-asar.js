const asar = require('@electron/asar');
const asarPath = 'release/win-unpacked/resources/app.asar';

// Check index.html
const html = asar.extractFile(asarPath, 'desktop\\renderer\\index.html').toString();
console.log('=== index.html ===');
console.log('TOPBAR:', html.includes('workspace-topbar'));
console.log('OLD ASIDE:', html.includes('workspace-nav panel'));
const lines = html.split('\n');
for (let i = 0; i < Math.min(35, lines.length); i++) {
  console.log((i+1) + ':', lines[i]);
}

// Check evaluationEngine.js
const ee = asar.extractFile(asarPath, 'desktop\\mainServices\\adLearning\\evaluationEngine.js').toString();
console.log('\n=== evaluationEngine.js ===');
console.log('softPass:', ee.includes('软通过'));
console.log('hasModelData:', ee.includes('hasModelData'));
console.log('avgLateInternal:', ee.includes('avgLateInternal'));
console.log('threshold 55:', ee.includes('55'));

// Check workspace.css
const css = asar.extractFile(asarPath, 'desktop\\renderer\\styles\\workspace.css').toString();
console.log('\n=== workspace.css ===');
console.log('topbar:', css.includes('workspace-topbar'));
console.log('old sidebar:', css.includes('workspace-nav panel'));
