'use strict';
const EXPECTED_PROJECT = 'just-dee-dee-music-map';
function assertProject(project) {
    if (project !== EXPECTED_PROJECT) {
        throw new Error(`JDDM deployment requires ${EXPECTED_PROJECT}; received ${project || '(missing project)'}.`);
    }
}
module.exports = { assertProject, EXPECTED_PROJECT };
if (require.main === module) {
    try { assertProject(process.argv[2]); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
