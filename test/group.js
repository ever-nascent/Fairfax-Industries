// One test per file ("700+ tests for one discord bot... overkill"). A file's `test(name, fn)` calls become checks of a single
// test named after the file: every check still runs, in order, and a failure names each check that failed. Use: const test = require('./group')(__filename);
const path = require('node:path');
const nodeTest = require('node:test');

module.exports = (file) => {
  const checks = [];
  nodeTest(path.basename(file, '.test.js'), async () => {
    const failed = [];
    for (const [name, fn] of checks) {
      try { await fn(); } catch (error) { failed.push(`- ${name}\n${error.stack ?? error}`); }
    }
    if (failed.length) throw new Error(`${failed.length} of ${checks.length} checks failed:\n${failed.join('\n\n')}`);
  });
  return Object.assign((name, fn) => { checks.push([name, fn]); }, { after: nodeTest.after }); // test.after: runs once the file's test is done
};
