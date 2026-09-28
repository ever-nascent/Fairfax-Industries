// Registry of button/modal handlers, so interactionCreate doesn't need to know
// every feature's custom IDs. Add new features' routes here.
const routes = [...require('./reactionRoles')];

function findComponentRoute(interaction) {
  return routes.find((route) => route.matches(interaction)) ?? null;
}

module.exports = { findComponentRoute };
