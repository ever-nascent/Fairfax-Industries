// Tournament brackets: Single Elimination, Double Elimination and Round Robin. No Discord and no storage in here: plain data in, plain data out.
// A bracket is { format, seeds: [team id], order: [match id], matches: { id: match } }. A match's two sides are sources:
//   { team: id } a seeded team (null = a bye), { win: matchId } that match's winner, { lose: matchId } that match's loser.
// Only results are stored on a match (`winner`: a team id, `score`: [winner's games, loser's games]). Who is in which match is worked out
// from the sources and the results every time (`resolve`), so correcting an old result moves everything after it by itself.
// Match ids: R<round>-<n> (Single Elimination, Round Robin), W<round>-<n> / L<round>-<n> / GF (Double Elimination).

// Where each seed sits in a bracket of `size`: [1, 8, 4, 5, 2, 7, 3, 6] for 8, so seeds 1 and 2 can only meet in the final.
function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    order = order.flatMap((s) => [s, sum - s]);
  }
  return order;
}

function add(bracket, id, a, b, extra) {
  bracket.matches[id] = { id, a, b, ...extra };
  bracket.order.push(id);
}

// The winners' side of an elimination bracket. Returns the number of rounds.
function eliminationRounds(bracket, teams, prefix) {
  let size = 2;
  while (size < teams.length) size *= 2;
  const order = seedOrder(size);
  const rounds = Math.log2(size);
  for (let n = 1; n <= size / 2; n++) {
    const side = (i) => ({ team: teams[order[i] - 1] ?? null });
    add(bracket, `${prefix}1-${n}`, side(2 * n - 2), side(2 * n - 1), { bracket: prefix, round: 1 });
  }
  for (let r = 2; r <= rounds; r++) {
    for (let n = 1; n <= size / 2 ** r; n++) add(bracket, `${prefix}${r}-${n}`, { win: `${prefix}${r - 1}-${2 * n - 1}` }, { win: `${prefix}${r - 1}-${2 * n}` }, { bracket: prefix, round: r });
  }
  return rounds;
}

// `teams`: team ids, best seed first. Needs at least 2.
function build(format, teams) {
  const bracket = { format, seeds: [...teams], order: [], matches: {} };
  if (format === 'single') {
    eliminationRounds(bracket, teams, 'R');
  } else if (format === 'double') {
    const rounds = eliminationRounds(bracket, teams, 'W');
    const size = 2 ** rounds;
    // The lower bracket. Round 1: the losers of W1 play each other. After that, for every later winners' round j: the lower bracket's
    // survivors play that round's losers (the losers enter in reverse order on even rounds, so early rematches are rarer), then play each other.
    let last = null; // the lower round just built
    let lr = 0;
    if (rounds >= 2) {
      lr = 1;
      for (let n = 1; n <= size / 4; n++) add(bracket, `L1-${n}`, { lose: `W1-${2 * n - 1}` }, { lose: `W1-${2 * n}` }, { bracket: 'L', round: 1 });
      last = 1;
      for (let j = 2; j <= rounds; j++) {
        const count = size / 2 ** j;
        lr += 1;
        for (let n = 1; n <= count; n++) add(bracket, `L${lr}-${n}`, { win: `L${last}-${n}` }, { lose: `W${j}-${j % 2 ? n : count + 1 - n}` }, { bracket: 'L', round: lr });
        last = lr;
        if (j < rounds) {
          lr += 1;
          for (let n = 1; n <= count / 2; n++) add(bracket, `L${lr}-${n}`, { win: `L${last}-${2 * n - 1}` }, { win: `L${last}-${2 * n}` }, { bracket: 'L', round: lr });
          last = lr;
        }
      }
    }
    add(bracket, 'GF', { win: `W${rounds}-1` }, last ? { win: `L${last}-1` } : { lose: 'W1-1' }, { bracket: 'GF', round: 1 });
  } else {
    // Round Robin, the circle method: the first team stays, the rest rotate. An odd count gets an empty seat (that team rests).
    const seats = teams.length % 2 ? [...teams, null] : [...teams];
    for (let r = 1; r < seats.length; r++) {
      let n = 0;
      for (let i = 0; i < seats.length / 2; i++) {
        const [a, b] = [seats[i], seats[seats.length - 1 - i]];
        if (a !== null && b !== null) add(bracket, `R${r}-${++n}`, { team: a }, { team: b }, { bracket: 'R', round: r });
      }
      seats.splice(1, 0, seats.pop());
    }
  }
  return bracket;
}

// Every match as it stands: { id: { a, b, state, winner, loser } }. a / b: a team id, null (a bye) or undefined (not known yet).
// state: 'waiting' (a side is not known yet), 'bye' (a side is empty: the other goes through unplayed), 'ready' (both known, no result), 'done'.
function resolve(bracket) {
  const out = {};
  const side = (src) => {
    if ('team' in src) return src.team;
    const from = get(src.win ?? src.lose);
    if (from.state === 'waiting' || from.state === 'ready') return undefined;
    return 'win' in src ? from.winner : from.loser;
  };
  function get(id) {
    if (out[id]) return out[id];
    const m = bracket.matches[id];
    const [a, b] = [side(m.a), side(m.b)];
    let r;
    if (a === undefined || b === undefined) r = { a, b, state: 'waiting' };
    else if (a === null || b === null) r = { a, b, state: 'bye', winner: a ?? b, loser: null };
    else if (m.winner === a || m.winner === b) r = { a, b, state: 'done', winner: m.winner, loser: m.winner === a ? b : a };
    else r = { a, b, state: 'ready' };
    out[id] = r;
    return r;
  }
  for (const id of bracket.order) get(id);
  return out;
}

// Forgets results that no longer fit (the winner is not in that match any more, after an earlier result was corrected). Returns the ids cleared.
function prune(bracket) {
  const cleared = [];
  for (;;) {
    const now = resolve(bracket);
    const stale = bracket.order.filter((id) => bracket.matches[id].winner != null && now[id].state !== 'done');
    if (!stale.length) return cleared;
    for (const id of stale) {
      for (const key of ['winner', 'score', 'report', 'checkedIn', 'pinged', 'flagged']) delete bracket.matches[id][key];
      cleared.push(id);
    }
  }
}

// Sets (or corrects) a match's result. Returns { ok, cleared } or { ok: false, reason: 'noMatch' | 'notReady' | 'notInMatch' }.
function setResult(bracket, id, winner, score = null) {
  const now = resolve(bracket)[id];
  if (!now) return { ok: false, reason: 'noMatch' };
  if (now.state !== 'ready' && now.state !== 'done') return { ok: false, reason: 'notReady' };
  if (winner !== now.a && winner !== now.b) return { ok: false, reason: 'notInMatch' };
  Object.assign(bracket.matches[id], { winner, score });
  delete bracket.matches[id].report;
  return { ok: true, cleared: prune(bracket) };
}

const finalId = (bracket) => (bracket.format === 'double' ? 'GF' : bracket.order.at(-1));

// Is every match that can be played played?
function complete(bracket) {
  const now = resolve(bracket);
  return bracket.format === 'robin' ? bracket.order.every((id) => now[id].state === 'done') : now[finalId(bracket)].state === 'done' || now[finalId(bracket)].state === 'bye';
}

// Round Robin table, best first: [{ team, played, wins, losses, diff }]. Ties: wins, then games won minus games lost, then seed.
function table(bracket) {
  const now = resolve(bracket);
  const rows = new Map(bracket.seeds.map((team) => [team, { team, played: 0, wins: 0, losses: 0, diff: 0 }]));
  for (const id of bracket.order) {
    if (now[id].state !== 'done') continue;
    const [w, l] = bracket.matches[id].score ?? [1, 0];
    const [win, lose] = [rows.get(now[id].winner), rows.get(now[id].loser)];
    win.played += 1; win.wins += 1; win.diff += w - l;
    lose.played += 1; lose.losses += 1; lose.diff -= w - l;
  }
  return [...rows.values()].sort((x, y) => y.wins - x.wins || y.diff - x.diff || bracket.seeds.indexOf(x.team) - bracket.seeds.indexOf(y.team));
}

// Final (or current) places, best first: [{ place, teams: [team id] }]. Teams knocked out in the same round share a place.
// Teams still in an unfinished elimination bracket come last as { place: null, teams }.
function standings(bracket) {
  if (bracket.format === 'robin') return table(bracket).map((row, i) => ({ place: i + 1, teams: [row.team] }));
  const now = resolve(bracket);
  const out = new Map(); // "bracket round" -> the teams knocked out there, in bracket order
  const final = finalId(bracket);
  for (const id of bracket.order) {
    const m = bracket.matches[id];
    if (now[id].state !== 'done' || (bracket.format === 'double' && m.bracket === 'W')) continue; // a winners' bracket loss is not out yet
    const key = `${m.bracket} ${m.round}`;
    out.set(key, [...(out.get(key) ?? []), now[id].loser]);
  }
  const groups = [...out.values()].reverse(); // the last round played is the best place
  const result = [];
  const champion = now[final].state === 'done' || now[final].state === 'bye' ? now[final].winner : null;
  const gone = new Set(groups.flat());
  const still = bracket.seeds.filter((team) => team !== champion && !gone.has(team));
  if (champion) result.push({ place: 1, teams: [champion] });
  let place = champion ? 2 : still.length + 1;
  for (const teams of groups) { result.push({ place, teams }); place += teams.length; }
  if (still.length) result.push({ place: null, teams: still });
  return result;
}

// "Round 2", "Semifinal", "Final", "Upper Round 1", "Lower Round 3", "Grand Final".
function roundName(bracket, match) {
  if (match.bracket === 'GF') return 'Grand Final';
  if (match.bracket === 'L') return `Lower Round ${match.round}`;
  if (bracket.format === 'robin') return `Round ${match.round}`;
  const rounds = Math.max(...bracket.order.map((id) => bracket.matches[id]).filter((m) => m.bracket === match.bracket).map((m) => m.round));
  const name = match.round === rounds ? 'Final' : match.round === rounds - 1 ? 'Semifinal' : `Round ${match.round}`;
  return match.bracket === 'W' ? `Upper ${name}` : name;
}

module.exports = { seedOrder, build, resolve, prune, setResult, complete, table, standings, roundName, finalId };
