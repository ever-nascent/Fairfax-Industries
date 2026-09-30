// Registry of button/select/modal handlers, so interactionCreate doesn't need to know
// every feature's custom IDs. Add new features' routes here.
const routes = [...require('./reactionRoles'), ...require('./shop'), ...require('./games'), ...require('./trivia'), ...require('./lockle'), ...require('./lfgPings'), ...require('./urn'), ...require('./hideout')];

function findComponentRoute(interaction) {
  return routes.find((route) => route.matches(interaction)) ?? null;
}

module.exports = { findComponentRoute };
