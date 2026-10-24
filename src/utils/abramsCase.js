// Abrams' Interrogation (abrams.js): the question pool and every hero's answers. His questions Oct 22, reworked Oct 23 (his
// picks): cut the ones that fit almost everyone (CC Ability) or only one or two heroes (Invisible, Swap Places, Cheat Death,
// Traps, Mask, Duo) and the judgment calls players can't predict (Technology, Elemental, Creature, Undead); added Stun,
// Silence, Pull, Unstoppable, five gun questions, Woman, Human, Horns, Tail, Beard, Coat and First Roster.
// Where the answers come from:
//   Stun / Silence / Pull / Unstoppable: each hero's ability text and properties (deadlock-api.com, deadlock.wiki); upgrades
//     count; a property that is 0 in the game doesn't (Bebop's, McGinnis's and Graves' unused stun fields); Unstoppable
//     counts becoming invulnerable, untargetable or immune too (Pocket's satchel, Viscous's Cube, Yamato's ultimate).
//   Gun questions: the game's own weapon tags (Burst Fire, Spreadshot, Rapid Fire, Long Range, Close Range: heroes.json).
//   Woman: the wiki's pronouns (She/Her; Pocket and Sinclair are They/Them). First Roster: wiki release date April 24, 2024.
//   Horns, Tail, Beard: the hero icons and renders. Coat, Human: judgment calls from the renders and lore, his to correct.
//   The rest (kept from Oct 22): upgrades count (an ability that can gain a charge, barrier or heal through an upgrade is a
//   Yes); Hat counts Baba's headscarf, Rat King's crown, Seven's headgear and Deadman Danny's helmet, not McGinnis's headband.
// Every hero's answers must differ from every other hero's (test/abrams.test.js), or two suspects could never be told apart.

// text: shown in the clue log (markdown); label: the dropdown option (no markdown, at most 100 characters); group: its description;
// note: the case board's handwritten sticky note for it (short).
const QUESTIONS = [
  { key: 'stun', text: 'Can the Character **Stun** you?', label: 'Can the Character Stun you?', group: 'Abilities', note: 'Stuns?' },
  { key: 'silence', text: 'Can the Character **Silence** you?', label: 'Can the Character Silence you?', group: 'Abilities', note: 'Silences?' },
  { key: 'pull', text: 'Can the Character **Displace** you?', label: 'Can the Character Displace you?', group: 'Abilities', note: 'Displaces?' },
  { key: 'unstoppable', text: 'Can the Character become **Unstoppable**, **Invulnerable** or **Untargetable**?', label: 'Can the Character become Unstoppable, Invulnerable or Untargetable?', group: 'Abilities', note: 'Unstoppable?' },
  { key: 'stacks', text: 'Does the Character have an Ability that can gain **Stacks**?', label: 'Does the Character have an Ability that can gain Stacks?', group: 'Abilities', note: 'Stacks?' },
  { key: 'charges', text: 'Does the Character have an ability with multiple **Charges**?', label: 'Does the Character have an ability with multiple Charges?', group: 'Abilities', note: 'Charges?' },
  { key: 'pet', text: 'Does the Character have a **Pet**, **Summon** or **Minion**?', label: 'Does the Character have a Pet, Summon or Minion?', group: 'Abilities', note: 'Pet / summon?' },
  { key: 'fly', text: 'Can the Character **Fly** or **Hover**?', label: 'Can the Character Fly or Hover?', group: 'Abilities', note: 'Flies?' },
  { key: 'dash', text: 'Does the Character have a **Movement-Related** ability?', label: 'Does the Character have a Movement-Related ability?', group: 'Abilities', note: 'Movement?' },
  { key: 'teleport', text: 'Can the Character **Teleport**?', label: 'Can the Character Teleport?', group: 'Abilities', note: 'Teleports?' },
  { key: 'heal', text: 'Can the Character **Heal** themselves or allies?', label: 'Can the Character Heal themselves or allies?', group: 'Abilities', note: 'Heals?' },
  { key: 'wall', text: 'Does the Character have an ability that provides a **Barrier** buff?', label: 'Does the Character have an ability that provides a Barrier buff?', group: 'Abilities', note: 'Barrier buff?' },
  { key: 'dot', text: 'Does the Character have an ability that deals **Damage Over Time**?', label: 'Does the Character have an ability that deals Damage Over Time?', group: 'Abilities', note: 'Burn / DoT?' },
  { key: 'execute', text: 'Does this Character have an ability with an **Execute**?', label: 'Does this Character have an ability with an Execute?', group: 'Abilities', note: 'Execute?' },
  { key: 'transform', text: 'Can the Character **Transform**?', label: 'Can the Character Transform?', group: 'Abilities', note: 'Transforms?' },
  { key: 'ultSingle', text: "Does the Character's **Ultimate** target a **Single Hero**?", label: "Does the Character's Ultimate target a Single Hero?", group: 'Abilities', note: 'Ult: 1 target?' },
  { key: 'ultChannel', text: "Does the Character's **Ultimate** require **Channeling**?", label: "Does the Character's Ultimate require Channeling?", group: 'Abilities', note: 'Ult channels?' },
  { key: 'burst', text: "Does the Character's gun fire in **Bursts**?", label: "Does the Character's gun fire in Bursts?", group: 'Gun', note: 'Burst fire?' },
  { key: 'spread', text: "Does the Character's gun fire a **Spread**, like a shotgun?", label: "Does the Character's gun fire a Spread, like a shotgun?", group: 'Gun', note: 'Shotgun?' },
  { key: 'rapid', text: "Is the Character's gun **Rapid Fire**?", label: "Is the Character's gun Rapid Fire?", group: 'Gun', note: 'Rapid fire?' },
  { key: 'longRange', text: "Is the Character's gun **Long Range**?", label: "Is the Character's gun Long Range?", group: 'Gun', note: 'Long range?' },
  { key: 'closeRange', text: "Is the Character's gun **Close Range**?", label: "Is the Character's gun Close Range?", group: 'Gun', note: 'Close range?' },
  { key: 'woman', text: 'Is the Character a **Woman**?', label: 'Is the Character a Woman?', group: 'Look and Lore', note: 'A woman?' },
  { key: 'human', text: 'Is the Character **Human**?', label: 'Is the Character Human?', group: 'Look and Lore', note: 'Human?' },
  { key: 'horns', text: 'Does the Character have **Horns**?', label: 'Does the Character have Horns?', group: 'Look and Lore', note: 'Horns?' },
  { key: 'tail', text: 'Does the Character have a **Tail**?', label: 'Does the Character have a Tail?', group: 'Look and Lore', note: 'Tail?' },
  { key: 'facialHair', text: 'Does the Character have a **Beard** or **Moustache**?', label: 'Does the Character have a Beard or Moustache?', group: 'Look and Lore', note: 'Beard?' },
  { key: 'coat', text: 'Does the Character wear a **Coat** or **Jacket**?', label: 'Does the Character wear a Coat or Jacket?', group: 'Look and Lore', note: 'Coat?' },
  { key: 'hat', text: 'Does the Character wear a **Hat**?', label: 'Does the Character wear a Hat?', group: 'Look and Lore', note: 'Hat?' },
  { key: 'glasses', text: 'Does the Character wear **Glasses** or **Goggles**?', label: 'Does the Character wear Glasses or Goggles?', group: 'Look and Lore', note: 'Glasses?' },
  { key: 'blade', text: 'Does the Character carry a **Blade**?', label: 'Does the Character carry a Blade?', group: 'Look and Lore', note: 'Blade?' },
  { key: 'firstRoster', text: "Was the Character in Deadlock's **First Roster** (April 2024)?", label: "Was the Character in Deadlock's First Roster (April 2024)?", group: 'Look and Lore', note: 'Day one?' },
];

// Each hero's answers, one letter per question in QUESTIONS order: Y = yes, N = no.
const ANSWERS = {
  'Abrams': 'YNYYNNNYYNYNYNNNNNYNNYNYYNNYNYNY',
  'Apollo': 'YNYYNNNYYNYNNYNNYNNNNNNYYNNYNNYN',
  'Baba': 'NYYNNNYNNNYYYNNNYNNYYNYYNNNNYYNN',
  'Bebop': 'NNYNYNNYNNYNNNNNYNNNNNNNNNNNNNNY',
  'Billy': 'NNYYYYNNYNNNNNNNNNNNNYNNNNNYNNNN',
  'Calico': 'NNNYNNYYYNYNNNYNYNYNNYYYNNNYNYNN',
  'Celeste': 'NYNNYNNNNNYYNNNNYNNNNNYYYNNYNNNN',
  'Deadman Danny': 'YNYNNNNYYNYNYYNYNYNNNNNNNNNYYYNN',
  'The Doorman': 'YNYYNYNNNYNYNNNYYNNNNNNYNNNYYNNN',
  'Drifter': 'NYNNYNNNYYYNYNNNNNYNNYNNNNNYYNNN',
  'Dynamo': 'YNYYNYNNYYYNYNNNYNNNNNNYNNNNNYNY',
  'Graves': 'NNNNYYYNNNYNYNNNYNNNNYYYNNNYNNNN',
  'Grey Talon': 'YYNNYYYYYNNNNYNNYNNNNNNYNNNNNNNY',
  'Haze': 'NNNNYYNNNNYNNNNNNNNYNYYYNNNNYNYY',
  'Holliday': 'YNYNNYNNYNNNYNNYNNNNNNYYNNNYYNNN',
  'Infernus': 'YNNNNYNNYNNNYNNNNNNYNNNYNNNYYNNY',
  'Ivy': 'YYNYNYNYYNYYYNYYNNNYNNYNNYNNYNNY',
  'Kelvin': 'NNYNYYNNYNYNYNNNNNNNNNNYNNYYNNNY',
  'Lady Geist': 'NYNNYYNNNNYNYNNYNNNNNNYYNNNNNNNY',
  'Lash': 'YNYNNYNNYNYNNNNNYYNNNNNYNNYNNNNY',
  'McGinnis': 'NNYNNYYNNNYNNNNNNNNYNNYYNNNNNNNY',
  'Mina': 'NYNYYNYYYYYNNNYNYYNNNNYNNNNYNNNN',
  'Mirage': 'YNNNYYYNYYNYYNYNNNNNNNNYNNYYNNNN',
  'Mo & Krill': 'YNYNYNNNYNYNYNNYYNYYNNNNNNNNNNNY',
  'Nurse Harrow': 'NNYYNYNNNNYNYNNNYNNYYNYYNNNNYNNN',
  'Paige': 'YNYNNYYNNNYYYNNNYNNYYNYYNNNNNYNN',
  'Paradox': 'NYNNYYNNYNNYYNNNNYNNNNYYNNNYNNNY',
  'Pocket': 'NNNYYNNNYYNNYNNNNNYNNYNYNNNYNNNY',
  'Rat King': 'NNYNNNYNNNNNYNNNYNYYNNNNNYNNYNNN',
  'Rem': 'NNYYNYYYNNYYNNNNYYNNNNNNNYNNYNNN',
  'Seven': 'YNNNNYNNNNNNYNNNYYNNNNNYNNNNYNNY',
  'Shiv': 'NNNNYYNNYNYNYYNYNNYNNYNYNNYNNNYN',
  'Silver': 'NNYNNNNNYNYNNNYNNNYNNNYNNNNYNNNN',
  'Sinclair': 'NNNNNNYNYYNNNNNYNYNNYNNYNNNYYNNN',
  'Solomon': 'YNYYYNYYYNNYNYNNNNNYYNNYNNYNNYNN',
  'Venator': 'YNYNNYNNNNNNYYNNNNNYNNNYNNYYNNYN',
  'Victor': 'YNNNNYNNNNYNYNNNYNNNNNNNNNNNNNNN',
  'Vindicta': 'NNYNYYYYYNNNYYNNNNNYYNYYNNNYNNNY',
  'Violet': 'YYYNYYNNYNYYYNNNYNNYYNYYNNNNYNNN',
  'Viscous': 'YNYYNNNNYNYNNNYNNNNNNNNNNNNNNNNN',
  'Vyper': 'NNNNYYNNYNNYNNNNNNNYNYYNNYNNNNYN',
  'Warden': 'NYNYNNNNNNYYNNYNNNNNNNNYNNYYYNNY',
  'Wraith': 'NYYNNYNNYYYYNNNYYNNYNNYYNNNYYNNY',
  'Yamato': 'NNNYNYNNYNYNNNYNYNYNNYYYNNNNNNYY',
};

// Does `hero` (its name, as in heroes.js) answer Yes to question `q` (an index in QUESTIONS)?
const answer = (hero, q) => ANSWERS[hero]?.[q] === 'Y';

module.exports = { QUESTIONS, ANSWERS, answer };
