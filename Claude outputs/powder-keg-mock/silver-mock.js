const { mock } = require('./mock.js');
const S = 'silver/';
const A = 'D:/Projects/Discord Bots/Fairfax Industries/assets/';
(async () => {
  await mock({
    file: 'silver-roulette-1-mid-game.png',
    label: '/mini-game game:Shotgun Roulette bet:100 - public message - vs Silver, after you shot yourself (blank), shot her (live), and she shot you (blank)',
    color: 0x9aa5b1 && '#9aa5b1',
    author: "Silver's Shotgun Roulette", authorIcon: A + S + 'slam_fire.png',
    title: 'Shotgun Roulette', thumb: A + S + 'portrait.png',
    lines: [
      [{ b: 'Zechariah' }, ' stakes ', { img: 'card/souls.png', s: 16 }, { b: '100 souls' }, ' against Silver.'],
      ['A win pays ', { img: 'card/souls.png', s: 16 }, { b: '185 souls' }, '.'],
      [],
      [{ b: 'Zechariah:' }, ' ', ...[0, 1, 2].map(() => ({ img: A + S + 'charge.png', s: 20 }))],
      [{ b: 'Silver:' }, ' ', ...[0, 1].map(() => ({ img: A + S + 'charge.png', s: 20 })), { img: A + S + 'charge_lost.png', s: 20 }],
      [{ b: 'Shotgun:' }, ' ', { img: A + S + 'shell_live.png', s: 20 }, ' 1 live, ', { img: A + S + 'shell_blank.png', s: 20 }, ' 2 blank'],
      [],
      Object.assign([{ b: 'Zechariah' }, ' shot themselves: click. Blank.'], { quote: true }),
      Object.assign([{ b: 'Zechariah' }, ' shot Silver: ', { b: 'BANG.' }, ' Live.'], { quote: true }),
      Object.assign([{ b: 'Silver' }, ' shot Zechariah: click. Blank.'], { quote: true }),
      [],
      [{ b: 'Zechariah, your turn.' }],
    ],
    footer: "\"Hair of the dog. Pull it, or don't.\"",
    buttons: [[{ label: 'Shoot Silver', style: 'danger' }, { label: 'Shoot Yourself', style: 'secondary' }]],
  });
})();
