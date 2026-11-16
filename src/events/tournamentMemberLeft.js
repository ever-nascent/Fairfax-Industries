// A member left the server: they come off their tournament teams (utils/server/tournaments.js `memberLeft`).
// A Captain's team goes to its longest-standing player, or is disbanded if nobody else is on it.
const T = require('../utils/server/tournaments');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    for (const r of await T.memberLeft(member.guild.id, member.id)) {
      if (r.disbanded) { await T.afterDisband(member.guild, r.t, r.team, r.promoted); continue; }
      if (r.newCaptainId) {
        await T.giveRole(member.guild, r.team, r.newCaptainId);
        await T.tellTeam(member.guild, r.team, `The Captain left the server. <@${r.newCaptainId}> is the Captain of **${r.team.name}** now.`);
      } else await T.tellTeam(member.guild, r.team, `<@${member.id}> left the server and is off the team.`);
    }
  },
};
