const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('visible app version labels share the same source version', () => {
    const version = JSON.parse(readRepoFile('version.json')).version;
    const indexHtml = readRepoFile('index.html');
    const barkState = readRepoFile('modules/barkState.js');

    const settingsMatch = /id="settings-app-version">(\d+)<\/span>/.exec(indexHtml);
    const stateDefaultMatch = /jddm_seen_version'\) \|\| '(\d+)'/.exec(barkState);

    assert.equal(Number.isInteger(version), true);
    assert.equal(Number(settingsMatch && settingsMatch[1]), version);
    assert.equal(Number(stateDefaultMatch && stateDefaultMatch[1]), version);
});

test('boot and search copy no longer exposes BARK branding to users', () => {
    const app = readRepoFile('core/app.js');
    const search = readRepoFile('modules/searchEngine.js');

    assert.equal(app.includes('B.A.R.K. Boot'), false);
    assert.equal(app.includes('JDDM Boot'), true);
    assert.equal(search.includes('No local B.A.R.K. matches'), false);
    assert.equal(search.includes('No local venue matches'), true);
});

test('marker panel user feedback uses app toast instead of native alerts', () => {
    const panelRenderer = readRepoFile('renderers/panelRenderer.js');

    assert.equal(panelRenderer.includes('alert('), false);
    assert.equal(panelRenderer.includes('notifyPanelUser('), true);
});
