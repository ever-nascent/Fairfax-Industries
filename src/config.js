// Fairfax Industries bot settings. Secrets (the token) live in .env, not here.
module.exports = {
  // The only server this bot will operate in (overridable with DISCORD_GUILD_ID in .env).
  GUILD_ID: process.env.DISCORD_GUILD_ID || '1553860143639167086',
  // Zechariah's Discord user id (the server owner). Passes every permission check on staff commands.
  OWNER_ID: '1378474650010652762',
  // Default embed color. Placeholder (Discord blurple) until we pick the server's colors.
  BRAND_COLOR: 0x5865f2,
  // Green of the level flask. Used for short bot replies (approved per reply, see server-plan.md).
  REPLY_COLOR: 0x6aa98a,
  // Channel the go-live alerts are posted in (#streams-and-uploads). Right-click a channel > Copy Channel ID.
  STREAM_CHANNEL_ID: '1554191144080908408',
  // Go-live alerts: Twitch channel name and TikTok username (after the @).
  TWITCH_LOGIN: 'charmedvt',
  TIKTOK_LOGIN: 'charmed.dl',
};
