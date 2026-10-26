'use strict';
// Run with an official main.js path; the downloaded game is never redistributed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const O = require('../cookie-optimizer.user.js');
const { fixture } = require('./fixture.cjs');

function installOfficial(g, source) {
  function section(start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first + start.length);
    if (first < 0 || last < 0) throw Error(`Official source changed: ${start}`);
    return source.slice(first, last);
  }
  g.Has = name => g.Upgrades[name]?.bought ? 1 : 0;
  g.hasBuff = name => g.buffs[name] || 0;
  g.auraMult = name => {
    const names = { 1: 'Breath of Milk', 2: 'Dragon Cursor', 3: 'Elder Battalion', 8: 'Dragon God', 15: 'Radiant Appetite' };
    return names[g.dragonAura] === name || names[g.dragonAura2] === name ? 1 : 0;
  };
  g.eff = (name, fallback = 1) => g.effs[name] ?? fallback;
  Object.assign(g, {
    heavenlyPower: 1, GetHeavenlyMultiplier: () => 1,
    heralds: 41, cookieUpgrades: [], AchievementsOwned: 100,
    CpsAchievements: [{ threshold: 1, name: 'actual-cps-threshold' }],
    shimmerTypes: { golden: { n: 0 } }, bakeryName: 'Browser test bakery',
    dragonAura: 0, dragonAura2: 0, lumps: 0,
  });
  for (const b of g.ObjectsById) b.cps = () => {
    let cps = b.baseCps;
    for (const u of b.tieredUpgrades) if (u.bought) cps *= u.mult || 2;
    return cps;
  };
  // Reuse only the three calculation functions, with Game bound to the fixture.
  new Function('Game', [
    section('Game.ComputeCps=function', 'Game.isMinigameReady='),
    section('Game.mouseCps=function', 'Game.computedMouseCps=1'),
    section('Game.CalculateGains=function', 'Game.dropRateMult=function'),
  ].join('\n'))(g);
}

function snapshot(g) {
  return JSON.stringify({
    cookies: g.cookies, earned: g.cookiesEarned, upgrades: g.UpgradesById.map(u => u.bought),
    buildings: g.ObjectsById.map(b => [b.amount, b.bought, b.highest, b.storedCps, b.storedTotalCps]),
    cps: g.cookiesPs, raw: g.cookiesPsRawHighest, byType: g.cookiesPsByType,
    mults: g.cookiesMultByType, milk: g.milkProgress, effs: g.effs, buffs: g.buffs,
  });
}

function run(sourcePath) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const f = fixture();
  f.building('Cursor', 10, 15, 0.1);
  const grandmas = f.building('Grandma', 10, 100, 1);
  const kitten = f.upgrade('Kitten helpers', 9000, { kitten: 1 });
  const mouse = f.upgrade('Plastic mouse', 1000);
  installOfficial(f.g, source); f.calculate();
  assert.ok(Math.abs(f.g.cookiesPs - 11) < 1e-9);
  const before = snapshot(f.g);
  const after = O.probe(f.g, [{ upgrade: kitten }], 20);
  assert.ok(Math.abs(after.passive - 15.4) < 1e-9, 'real milk and kitten multiplier');
  assert.equal(before, snapshot(f.g), 'real gains rollback');
  assert.deepEqual(f.events, [], 'no hypothetical achievements or lump updates');
  const clickAfter = O.probe(f.g, [{ upgrade: mouse }], 20);
  assert.ok(Math.abs(clickAfter.click - 22.2) < 1e-9, 'real percent-of-CpS mouse upgrade');
  f.g.buffs.Frenzy = { multCpS: 7 }; f.g.CalculateGains(); f.events.length = 0;
  const withBuff = snapshot(f.g);
  assert.ok(Math.abs(O.probe(f.g).passive - 11) < 1e-9);
  assert.equal(snapshot(f.g), withBuff, 'real frenzy restored');
  const oldCps = grandmas.cps;
  grandmas.cps = () => { throw Error('building failure'); };
  assert.throws(() => O.probe(f.g, [{ building: grandmas, count: 5 }]), /building failure/);
  assert.equal(snapshot(f.g), withBuff, 'real calculation failure rollback');
  grandmas.cps = oldCps;
  console.log('Official CalculateGains + mouseCps: 7 assertions passed');
}

module.exports = { installOfficial, run };
if (require.main === module) run(process.argv[2]);
