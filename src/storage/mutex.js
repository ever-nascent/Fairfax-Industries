// Serializes async work per key by chaining promises. Since the bot runs in a
// single process, this is enough to make read-modify-write sequences atomic and
// to stop concurrent writes from clobbering each other.
const chains = new Map();

function withLock(key, task) {
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  // Keep the chain alive even if a task rejects, so later work still runs.
  chains.set(
    key,
    run.then(
      () => {},
      () => {},
    ),
  );
  return run;
}

module.exports = { withLock };
