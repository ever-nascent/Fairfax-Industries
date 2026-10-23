// Abrams' Interrogation (abrams.js): the question pool and every hero's answers (his questions, Oct 22; answers researched
// Oct 22 from each hero's deadlock.wiki page and the full-body renders in assets/heroes/full body, his to correct).
// Rules used for the answers: upgrades count (an ability that can gain a charge, barrier or heal through an upgrade is a Yes);
// a slow alone is not CC (CC = stun, root, immobilize, silence, sleep, disarm, pull, knockup, fear, petrify, time stop, hex);
// Swap Places means with another hero (Sinclair's assistant and Lady Geist's health swap are No); Hat counts Baba's headscarf,
// Rat King's crown, Seven's headgear and Deadman Danny's helmet, not McGinnis's headband; Apollo's mask is only in his ult (No).
// Every hero's answers must differ from every other hero's (test/abrams.test.js), or two suspects could never be told apart.

// text: shown in the clue log (markdown); label: the dropdown option (no markdown, at most 100 characters); group: its description.
const QUESTIONS = [
  { key: 'cc', text: 'Does the Character have a **CC Ability**?', label: 'Does the Character have a CC Ability?', group: 'Abilities' },
  { key: 'stacks', text: 'Does the Character have an ability with **Stacks**?', label: 'Does the Character have an ability with Stacks?', group: 'Abilities' },
  { key: 'charges', text: 'Does the Character have an ability with multiple **Charges**?', label: 'Does the Character have an ability with multiple Charges?', group: 'Abilities' },
  { key: 'pet', text: 'Does the Character have a **Pet**, **Summon** or **Minion**?', label: 'Does the Character have a Pet, Summon or Minion?', group: 'Abilities' },
  { key: 'traps', text: 'Can the Character place **Traps**?', label: 'Can the Character place Traps?', group: 'Abilities' },
  { key: 'fly', text: 'Can the Character **Fly** or **Hover**?', label: 'Can the Character Fly or Hover?', group: 'Abilities' },
  { key: 'dash', text: 'Does the Character have a **Dash**, **Leap** or **Grapple** ability?', label: 'Does the Character have a Dash, Leap or Grapple ability?', group: 'Abilities' },
  { key: 'teleport', text: 'Can the Character **Teleport**?', label: 'Can the Character Teleport?', group: 'Abilities' },
  { key: 'invisible', text: 'Can the Character go **Invisible**?', label: 'Can the Character go Invisible?', group: 'Abilities' },
  { key: 'heal', text: 'Can the Character **Heal** themselves or allies?', label: 'Can the Character Heal themselves or allies?', group: 'Abilities' },
  { key: 'wall', text: 'Can the Character make a **Wall** or **Barrier**?', label: 'Can the Character make a Wall or Barrier?', group: 'Abilities' },
  { key: 'dot', text: 'Does the Character have an ability that deals **Damage Over Time**?', label: 'Does the Character have an ability that deals Damage Over Time?', group: 'Abilities' },
  { key: 'execute', text: 'Does the Character have an **Execute**, an ability that hits harder on low health enemies?', label: 'Does the Character have an Execute, an ability that hits harder on low health enemies?', group: 'Abilities' },
  { key: 'transform', text: 'Can the Character **Transform**?', label: 'Can the Character Transform?', group: 'Abilities' },
  { key: 'swap', text: 'Can the Character **Swap Places** with another hero?', label: 'Can the Character Swap Places with another hero?', group: 'Abilities' },
  { key: 'cheatDeath', text: 'Can the Character **Cheat Death**?', label: 'Can the Character Cheat Death?', group: 'Abilities' },
  { key: 'ultSingle', text: "Does the Character's **Ultimate** target a single hero?", label: "Does the Character's Ultimate target a single hero?", group: 'Abilities' },
  { key: 'ultChannel', text: "Does the Character's **Ultimate** require **Channeling**?", label: "Does the Character's Ultimate require Channeling?", group: 'Abilities' },
  { key: 'hat', text: 'Does the Character wear a **Hat**?', label: 'Does the Character wear a Hat?', group: 'Look and Lore' },
  { key: 'mask', text: 'Does the Character wear a **Mask** or **Face Covering**?', label: 'Does the Character wear a Mask or Face Covering?', group: 'Look and Lore' },
  { key: 'glasses', text: 'Does the Character wear **Glasses** or **Goggles**?', label: 'Does the Character wear Glasses or Goggles?', group: 'Look and Lore' },
  { key: 'blade', text: 'Does the Character carry a **Blade**?', label: 'Does the Character carry a Blade?', group: 'Look and Lore' },
  { key: 'creature', text: 'Is the Character a **Creature**, such as an animal?', label: 'Is the Character a Creature, such as an animal?', group: 'Look and Lore' },
  { key: 'undead', text: 'Is the Character **Undead** or a **Spirit**?', label: 'Is the Character Undead or a Spirit?', group: 'Look and Lore' },
  { key: 'duo', text: 'Is the Character a **Duo** (like Mo & Krill)?', label: 'Is the Character a Duo (like Mo & Krill)?', group: 'Look and Lore' },
  { key: 'elemental', text: 'Does the Character use **Elemental Powers** (fire, ice or lightning)?', label: 'Does the Character use Elemental Powers (fire, ice or lightning)?', group: 'Look and Lore' },
  { key: 'tech', text: 'Does the Character rely on **Technology** or gadgets?', label: 'Does the Character rely on Technology or gadgets?', group: 'Look and Lore' },
];

// Each hero's answers, one letter per question in QUESTIONS order: Y = yes, N = no.
const ANSWERS = {
  'Abrams': 'YNNNNNYNNYNYNNNNNNNNYNNNNNN',
  'Apollo': 'YNNNNNYNNYNNYNNNNYNNNYNNNNN',
  'Baba': 'YYNNNNYNNNYYNNNNNYYNYNNNNNN',
  'Bebop': 'YYNNNYNNNNNNNNNNNYNNNNYNNNY',
  'Billy': 'YNYNNNYNNNNNNNNNNNNNNNYNNNN',
  'Calico': 'NYNYNNYNNYNNNYNNNNNNYNNNNNN',
  'Celeste': 'YYNNNNNNNYYNNNNNNNNNNNYNNNN',
  'Deadman Danny': 'YNNNNYYNNYNYYNNNYNYNYNNNNNY',
  'The Doorman': 'YNYNNNNYNNNNNNNNYYYNNNNNNNN',
  'Drifter': 'YYNNNNNYNYNYNNNNNNYNNNYYNNN',
  'Dynamo': 'YNYNNNNYNYNYNNNNNYNNYNNNNNY',
  'Graves': 'YYYYNNNNNYYYNNNNNYNNNNNNNNN',
  'Grey Talon': 'YYYYYYYNNNNNYNNNNYNNNNNNNNN',
  'Haze': 'YYYNNNNNYYNNNNNNNYYNNYNNNNY',
  'Holliday': 'YYYNNNYNNNNYNNNNYNYNNNNNNYN',
  'Infernus': 'YNYNNNYNNNNYNNNNNNYNNNYNNYN',
  'Ivy': 'YNYNNYNNNYYYNYNNNNYNNNYNNNN',
  'Kelvin': 'NNYNNNNNNYYYNNNNNNNNNNNYNYN',
  'Lady Geist': 'YYYNNNNNNYNYNNNNYNNNNNNNNNN',
  'Lash': 'YNYNNNYNNYNNNNNNNYNNNNNNNNN',
  'McGinnis': 'NNYYNNNNNYYYNNNNNNNNNNNNNNY',
  'Mina': 'YYNYNYNYNYNNYYNNNYNNNNYYNNN',
  'Mirage': 'YYYNNNNYNYNYNYNNNYNNNNNNNYN',
  'Mo & Krill': 'YYNNNNNNNYNYNNNNYYNNNNYNYNN',
  'Nurse Harrow': 'YYYNNNNNNYNYNNNNNYYNNNNNNNN',
  'Paige': 'YNYYNNNNNYYYNNNNNYNNYNNNNNN',
  'Paradox': 'YYYNNNNNNNYYNNYNYNNYNNNNNNN',
  'Pocket': 'NYNNNNNYNNNYNNNNNNNNNNNNNNN',
  'Rat King': 'YNNYNNNNNNYYNNNNNNYNNNYNNNN',
  'Rem': 'YNYYNYYNNYNNNNNNNYYNNNYNNNN',
  'Seven': 'YNYNNNNNNNNYNNNNNYYYNNNNNYY',
  'Shiv': 'NYYNNNYNNYNYYNNNYNNNNYNNNNN',
  'Silver': 'YYNNNNYNNYNNNYNNNNNNNNYNNNN',
  'Sinclair': 'YNNYNNNYNNNNNNNNYNYNNNNYYNN',
  'Solomon': 'YYNYNNNNNNYNYNNNNNNNYNNNNNN',
  'Venator': 'YNYNYNNNNNNYYNNNNNNNNYNNNYN',
  'Victor': 'YNYNNNNNNYNYNNNYNYNNNNNYNYY',
  'Vindicta': 'YYYYNYYNNNNYYNNNNNNNNNNYNNN',
  'Violet': 'YYYNNNNNNYYYNNNNNYYNNNNNNNN',
  'Viscous': 'YNNNNNNNNYYNNYNNNNNNNNYNNNN',
  'Vyper': 'YYYNNNYNNNYNYNNNNNNNNYYNNNN',
  'Warden': 'YNNNNNNNNYYNNNNNNYYNNNNNNNN',
  'Wraith': 'YNYNNNNYNYYNNNNNYYYNNNNNNNY',
  'Yamato': 'NNYNNNYNNYNNNYNNNYNNNYNNNNN',
};

// Does `hero` (its name, as in heroes.js) answer Yes to question `q` (an index in QUESTIONS)?
const answer = (hero, q) => ANSWERS[hero]?.[q] === 'Y';

module.exports = { QUESTIONS, ANSWERS, answer };
