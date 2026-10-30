// Registry of button/select/modal handlers, so interactionCreate doesn't need to know
// every feature's custom IDs. Add new features' routes here.
const routes = [...require('./reactionRoles'), ...require('./shop'), ...require('./games'), ...require('./paige'), ...require('./trivia'), ...require('./lockle'), ...require('./lfgPings'), ...require('./lfgRegions'),...require('./urn'), ...require('./soulsReset'),...require('./hideout'), ...require('./farm'), ...require('./soulBag'), ...require('./item')];

function findComponentRoute(interaction) {
  return routes.find((route) => route.matches(interaction)) ?? null;
}

module.exports = { findComponentRoute };
