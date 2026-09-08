'use strict';
// Local accounting goes to stderr so existing JSON CLI output remains parseable.
// Call begin synchronously before starting the worker's asynchronous main function.
const store = require('./operationStore');
function begin(processName) {
  if (store.context.getStore()) return;
  const state = {process: processName, started: Date.now(), collections: {}};
  store.context.enterWith(state);
  process.once('exit', code => console.error('[jddm-io]', JSON.stringify({
    version: 1, release: 'efficiency-v1', process: processName,
    status: code ? 'error' : 'ok', durationMs: Date.now() - state.started,
    collections: state.collections
  })));
}
module.exports = {begin, operationDb: store.operationDb};
