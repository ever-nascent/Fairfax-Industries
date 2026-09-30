const P = 'D:/Projects/Discord Bots/Fairfax Industries/';
const { mock } = require(P + 'Claude outputs/powder-keg-mock/mock.js');
const S = (id) => `trivia/abilities/${id}.png`;
const base = {
  author: "Yamato's Dojo", authorIcon: 'heroes/yamato.png', thumb: 'heroes/yamato.png', color: '#7b5ea7',
  title: 'Duel of Stances',
};
const who = [{ ping: '@Zechariah' }, ' vs ', { ping: '@Friend' }, ', ', { img: 'card/souls.png' }, { b: '200' }, ' each.'];
const btns = (disabled) => [[
  { label: 'Power Slash', icon: S('power_slash'), disabled },
  { label: 'Flying Strike', icon: S('flying_slash'), disabled },
  { label: 'Crimson Slash', icon: S('crimson_slash'), disabled },
]];
const rule = 'Power Slash beats Flying Strike, Flying Strike beats Crimson Slash, Crimson Slash beats Power Slash.';

(async () => {
  await mock({ ...base, file: 'yamato-rps-1-challenge.png',
    label: `MOCKUP 1 of 3 · Yamato's Duel of Stances · someone runs /mini-game game:Duel of Stances bet:200 opponent:@Friend. Public message; only @Friend can accept. ${rule}`,
    lines: [who, [{ img: 'card/souls.png' }, 'Pot if accepted: ', { b: '400' }], [], [{ ping: '@Friend' }, ', you have been challenged. Accept?']],
    footer: '"Draw your blade or walk away. Both are answers."',
    buttons: [[{ label: 'Accept', style: 'success' }, { label: 'Decline', style: 'danger' }]] });

  await mock({ ...base, file: 'yamato-rps-2-choosing.png',
    label: 'MOCKUP 2 of 3 · after Accept. Each player presses a stance; the click is private (green embed only they see: "You chose Power Slash"). Buttons stay until both have picked.',
    lines: [who, [{ img: 'card/souls.png' }, 'Pot: ', { b: '400' }], [], ['Pick your stance. Your opponent can\'t see it.'], [{ b: 'Zechariah: ' }, 'ready'], [{ b: 'Friend: ' }, 'choosing...']],
    footer: '"Choose. Hesitation is a stance too, and it always loses."',
    buttons: btns(false) });

  await mock({ ...base, file: 'yamato-rps-3-result.png', color: '#248046',
    label: 'MOCKUP 3 of 3 · result. Buttons gone/disabled, winner takes the pot. A tie (same stance) gives both their bet back and a rematch button. No pick within 5 min: called off, both refunded.',
    lines: [who, [], [{ b: 'Zechariah' }, ' chose ', { img: S('power_slash'), s: 18 }, { b: 'Power Slash' }], [{ b: 'Friend' }, ' chose ', { img: S('flying_slash'), s: 18 }, { b: 'Flying Strike' }], [], [{ b: 'Power Slash' }, ' beats ', { b: 'Flying Strike' }, '.'], [{ ping: '@Zechariah' }, ' wins ', { img: 'card/souls.png' }, { b: '400' }, '.']],
    footer: '"Too slow. Again."',
    buttons: [[{ label: 'Rematch', style: 'primary' }]] });
})();
