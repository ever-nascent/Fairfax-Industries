// Chat export (/export-chat): turns a channel's messages into one HTML file a moderator can download.
// `messageHtml` is one message, `pageHtml` the whole file, `exportChannel` reads the channel from Discord (newest first, 100 a request).
// Everything a member wrote goes through `esc`, so nothing in a message can run as code in the file.
const { MessageType } = require('discord.js');

// The file has to fit a Discord upload (10 MB without boosts). The export stops at this size and keeps the newest messages.
const MAX_BYTES = 8 * 1024 * 1024;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Only http(s) links become clickable (a "javascript:" link in an embed must not).
const link = (url, text) => (/^https?:\/\//i.test(url ?? '') ? `<a href="${esc(url)}">${esc(text)}</a>` : esc(text));

function messageHtml(m) {
  const parts = [];
  const text = m.system ? `[${MessageType[m.type] ?? 'System'}] ${m.cleanContent ?? ''}`.trim() : m.cleanContent;
  if (text) parts.push(`<div class="text">${esc(text)}</div>`);
  for (const e of m.embeds ?? []) {
    const lines = [e.author?.name, e.title, e.description, ...(e.fields ?? []).map((f) => `${f.name}: ${f.value}`), e.footer?.text].filter(Boolean);
    if (lines.length) parts.push(`<div class="embed">${esc(lines.join('\n'))}</div>`);
  }
  for (const a of m.attachments?.values() ?? []) parts.push(`<div class="file">File: ${link(a.url, a.name ?? 'attachment')}</div>`);
  for (const s of m.stickers?.values() ?? []) parts.push(`<div class="file">Sticker: ${esc(s.name)}</div>`);
  const name = m.member?.displayName ?? m.author?.displayName ?? m.author?.username ?? 'Unknown';
  const when = new Date(m.createdTimestamp).toISOString();
  const tags = `${m.author?.bot ? ' <span class="tag">BOT</span>' : ''}${m.editedTimestamp ? ' <span class="tag">edited</span>' : ''}`;
  return `<div class="msg"><b title="${esc(m.author?.username)} (${esc(m.author?.id)})">${esc(name)}</b>${tags} <time datetime="${when}">${when.replace('T', ' ').slice(0, 16)} UTC</time>${parts.join('')}</div>`;
}

// `blocks` are messageHtml strings, oldest first.
function pageHtml({ guild, channel, by, cut }, blocks) {
  const title = `#${esc(channel)} in ${esc(guild)}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body{background:#313338;color:#dbdee1;font:15px/1.4 "Segoe UI",Helvetica,Arial,sans-serif;margin:0 auto;max-width:900px;padding:16px}
h1{font-size:20px;color:#fff;margin:0}
.info{color:#949ba4;margin:4px 0 16px;border-bottom:1px solid #3f4147;padding-bottom:12px}
.msg{padding:6px 0}
.msg b{color:#fff}
time,.tag{color:#949ba4;font-size:12px}
.text{white-space:pre-wrap;overflow-wrap:anywhere}
.embed{white-space:pre-wrap;overflow-wrap:anywhere;border-left:4px solid #5865f2;background:#2b2d31;padding:6px 10px;margin:4px 0;border-radius:4px}
.file{color:#949ba4}
a{color:#00a8fc}
</style></head><body>
<h1>${title}</h1>
<div class="info">${blocks.length.toLocaleString('en-US')} messages. Exported by ${esc(by)} on ${new Date().toISOString().slice(0, 10)}.${cut ? ' The channel was too long for one file, so this holds the newest messages only.' : ''} File links stop working after a while.</div>
${blocks.join('\n')}
<script>for(const t of document.querySelectorAll('time'))t.textContent=new Date(t.dateTime).toLocaleString()</script>
</body></html>`;
}

// Reads the whole channel. Returns { html, count, cut } (cut: it hit MAX_BYTES and older messages were left out).
async function exportChannel(channel, by, maxBytes = MAX_BYTES) {
  const blocks = [];
  let bytes = 0;
  let before;
  let cut = false;
  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    for (const m of batch.values()) {
      const block = messageHtml(m);
      bytes += Buffer.byteLength(block) + 1;
      if (bytes > maxBytes) { cut = true; break; }
      blocks.push(block);
    }
    if (cut) break;
    before = batch.last().id;
  }
  blocks.reverse();
  return { html: pageHtml({ guild: channel.guild.name, channel: channel.name, by, cut }, blocks), count: blocks.length, cut };
}

module.exports = { MAX_BYTES, esc, messageHtml, pageHtml, exportChannel };
