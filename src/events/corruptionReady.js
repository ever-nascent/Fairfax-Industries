const { loadCorruptionLabels } = require('../utils/farm/corruption');

// On startup: the game's labels for corrupted items' bonuses (deadlock-api.com), downloaded when missing or a week old (corruption.js).
module.exports = {
  name: 'clientReady',
  once: true,
  execute: () => loadCorruptionLabels(),
};
