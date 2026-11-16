// Event handler: clientReady.
// On startup: the game's labels for corrupted items' bonuses (deadlock-api.com), downloaded when missing or a week old (corruption.js).

const { loadCorruptionLabels } = require('../utils/farm/corruption');

module.exports = {
  name: 'clientReady',
  once: true,
  execute: () => loadCorruptionLabels(),
};
