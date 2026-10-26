'use strict';
const assert = require('node:assert/strict');
const O = require('../cookie-optimizer.user.js');
const { fixture, memoryStorage } = require('./fixture.cjs');

function run() {
  let passed = 0;
  const failures = [];
  function test(name, fn) {
    try { fn(); passed++; }
    catch (error) { failures.push({ name, error }); }
  }
  const config = changes => O.sanitize({ reserveMode: 'off', autoDragon: false, autoSanta: false, ...changes });
  const engineFor = (f, settings = {}, storage = memoryStorage()) => {
    const e = O.createEngine(f.g, { now: f.now, storage });
    e.setConfig({ autoDragon: false, autoSanta: false, reserveMode: 'off', ...settings });
    return e;
  };

  test('configuration rejects nonfinite values and caps click rate', () => {
    assert.equal(O.sanitize({ clicksPerSecond: 10000 }).clicksPerSecond, 40);
    assert.equal(O.sanitize({ prestigeGainRatio: NaN }).prestigeGainRatio, 1);
    assert.equal(O.sanitize({ maxBundle: -1 }).maxBundle, 1);
    assert.equal(O.sanitize({ autoAscend: 'false' }).autoAscend, true);
  });
  test('probe restores game, buildings, upgrades and map identities', () => {
    const f = fixture(); const b = f.building('Cursor', 1, 15, 2);
    const u = f.upgrade('Double', 30, { gainMult: 2 });
    f.calculate();
    const before = JSON.stringify(f.g);
    const maps = [f.g.cookiesPsByType, f.g.cookiesMultByType, f.g.effs, f.g.buffs];
    assert.equal(O.probe(f.g, [{ building: b, count: 5 }, { upgrade: u }], 20).income, 44);
    assert.equal(JSON.stringify(f.g), before);
    assert.deepEqual([f.g.cookiesPsByType, f.g.cookiesMultByType, f.g.effs, f.g.buffs], maps);
    assert.equal(f.g.cookiesPsByType, maps[0]);
    assert.deepEqual(f.events, []);
  });
  test('probe rolls back even when CalculateGains throws', () => {
    const f = fixture(); const b = f.building('Cursor', 1, 15, 2);
    f.calculate(); const oldWin = f.g.Win; const map = f.g.cookiesPsByType;
    const before = JSON.stringify(f.g);
    f.g.CalculateGains = () => { f.g.cookiesPs = 999; b.storedCps = 999; f.g.cookiesPsByType.bad = 1; throw Error('boom'); };
    assert.throws(() => O.probe(f.g, [{ building: b, count: 1 }]), /boom/);
    assert.equal(JSON.stringify(f.g), before);
    assert.equal(f.g.Win, oldWin); assert.equal(f.g.cookiesPsByType, map);
  });
  test('hypothetical purchases never run buyFunction or award achievements', () => {
    const f = fixture(); f.building('Cursor', 1, 15, 2);
    const u = f.upgrade('Double', 10, { gainMult: 2, buyFunction: () => { throw Error('must not run'); } });
    f.calculate(); O.probe(f.g, [{ upgrade: u }]); assert.deepEqual(f.events, []);
  });
  test('stable planning excludes temporary buffs but restores them', () => {
    const f = fixture(); f.building('Cursor', 1, 15, 2);
    f.g.buffs = { Frenzy: { multCpS: 7 } }; f.calculate();
    assert.equal(O.probe(f.g).income, 2);
    assert.equal(O.probe(f.g, [], 0, false).income, 14);
    assert.equal(f.g.cookiesPs, 14); assert.equal(f.g.buffs.Frenzy.multCpS, 7);
  });
  test('rounding prices matches actual per-building buys and rolls back', () => {
    const f = fixture(); const b = f.building('Cursor', 0, 1, 1);
    assert.equal(O.buildingPrice(b, 3), 5); assert.equal(b.amount, 0);
    const before = f.g.cookies; O.buyBuilding(f.g, b, 3);
    assert.equal(before - f.g.cookies, 5);
  });
  test('buying in sell mode never sells and restores user bulk selection', () => {
    const f = fixture(); const b = f.building('Cursor', 5, 15, 2);
    f.g.buyMode = -1; f.g.buyBulk = 100;
    assert.ok(O.buyBuilding(f.g, b, 1)); assert.equal(b.amount, 6);
    assert.equal(f.g.buyMode, -1); assert.equal(f.g.buyBulk, 100);
    assert.ok(!f.events.some(e => e.startsWith('sell:')));
  });
  test('purchase mode is restored after a failing buy', () => {
    const f = fixture(); const b = f.building('Cursor', 1, 15, 2);
    f.g.buyMode = -1; f.g.buyBulk = 100; b.buy = () => { throw Error('boom'); };
    assert.throws(() => O.buyBuilding(f.g, b, 1)); assert.equal(f.g.buyMode, -1); assert.equal(f.g.buyBulk, 100);
  });
  test('planner prefers greater incremental income per cost', () => {
    const f = fixture(); const a = f.building('A', 1, 100, 1); const b = f.building('B', 1, 100, 10);
    f.calculate(); assert.equal(O.plan(f.g, config(), 0).best.item, b); assert.equal(a.amount, 1);
  });
  test('click upgrades matter only when clicking is enabled', () => {
    const f = fixture(); f.building('Cursor', 1, 1000, 1);
    const u = f.upgrade('Mouse', 10, { clickMult: 3 }); f.calculate();
    assert.equal(O.plan(f.g, config(), 20).best.item, u);
    assert.ok(!O.plan(f.g, config(), 0).candidates.some(c => c.item === u));
  });
  test('planner includes total building-threshold AND upgrade cost', () => {
    const f = fixture(); const b = f.building('Cursor', 4, 10, 1);
    const u = f.upgrade('Tier 2', 10, { unlocked: 0, tier: 2, buildingTie: b, mult: 100 });
    b.tieredUpgrades.push(u); f.g.Tiers[2] = { unlock: 5 }; f.calculate();
    const candidate = O.plan(f.g, config(), 0).best;
    assert.equal(candidate.kind, 'bundle'); assert.equal(candidate.count, 1); assert.equal(candidate.price, 20);
    assert.equal(candidate.delta, 496); assert.equal(u.unlocked, 0); assert.equal(u.bought, 0);
  });
  test('planner can wait for an upgrade rather than waste savings on bad buildings', () => {
    const f = fixture(); f.building('Cursor', 10, 25, 1);
    const u = f.upgrade('Power', 100, { gainMult: 100 }); f.g.cookies = 50; f.calculate();
    const p = O.plan(f.g, config(), 0); assert.equal(p.best.item, u); assert.equal(p.best.wait, 5);
  });
  test('vault, lump, debug, toggle and unknown click-handler upgrades are excluded', () => {
    const f = fixture(); f.building('Cursor', 1, 10, 1);
    const blocked = [f.upgrade('Vault', 1), f.upgrade('Lump', 1, { priceLumps: 1 }),
      f.upgrade('Debug', 1, { pool: 'debug' }), f.upgrade('Switch', 1, { pool: 'toggle' }),
      f.upgrade('Picker', 1, { clickFunction: () => true })];
    f.g.vault = [blocked[0].id]; f.calculate();
    assert.ok(blocked.every(u => !O.allowedUpgrade(f.g, u, config())));
  });
  test('chocolate egg is reserved until ascension', () => {
    const f = fixture(); const egg = f.upgrade('Chocolate egg', 1);
    assert.equal(O.allowedUpgrade(f.g, egg, config()), false);
  });
  test('grandmapocalypse policy limits research at the requested stage', () => {
    const f = fixture(); const first = f.upgrade('One mind', 1, { pool: 'tech', clickFunction: () => false });
    const later = f.upgrade('Communal brainsweep', 1, { pool: 'tech' });
    assert.ok(O.allowedUpgrade(f.g, first, config())); assert.ok(!O.allowedUpgrade(f.g, later, config()));
    assert.ok(O.allowedUpgrade(f.g, later, config({ grandmapocalypse: 'full' })));
    assert.ok(!O.allowedUpgrade(f.g, first, config({ autoResearch: false })));
  });
  test('smart Lucky bank reinvests fast-payback purchases and retains slow-purchase reserve', () => {
    const f = fixture(); f.upgrade('Get lucky', 1, { bought: 1 });
    assert.equal(O.reserveFor(f.g, config({ reserveMode: 'smart' }), 10, 100), 0);
    assert.equal(O.reserveFor(f.g, config({ reserveMode: 'smart' }), 10, 1000), 420000);
  });
  test('ascension uses lifetime prestige minus already owned prestige', () => {
    const f = fixture(); f.g.prestige = 100; f.g.cookiesReset = 100 ** 3 * 1e12;
    f.g.cookiesEarned = (200 ** 3 - 100 ** 3) * 1e12;
    const info = O.ascendInfo(f.g, config(), f.now()); assert.equal(info.gain, 100); assert.equal(info.target, 100); assert.ok(info.ready);
  });
  test('first ascension waits for configured chips, age, buffs and challenge mode', () => {
    const f = fixture(); f.g.cookiesEarned = 500 ** 3 * 1e12;
    assert.ok(O.ascendInfo(f.g, config(), f.now()).ready);
    f.g.startDate = f.now(); assert.ok(!O.ascendInfo(f.g, config(), f.now()).ready);
    f.g.startDate -= 3600000; f.g.buffs.Frenzy = { multCpS: 7 }; assert.ok(!O.ascendInfo(f.g, config(), f.now()).ready);
    f.g.buffs = {}; f.g.ascensionMode = 1; assert.ok(!O.ascendInfo(f.g, config(), f.now()).ready);
  });
  test('uncollected wrinklers count toward ascension readiness without granting cookies', () => {
    const f = fixture(); f.g.cookiesEarned = 1e18;
    f.g.wrinklers = [{ phase: 2, sucked: 2e20, type: 0 }];
    const info = O.ascendInfo(f.g, config(), f.now());
    assert.ok(info.gain < 440); assert.ok(info.projectedGain >= 440); assert.ok(info.ready);
    assert.equal(f.g.cookiesEarned, 1e18); assert.equal(f.g.cookies, 1000);
  });
  test('wrinkler payout includes shiny, upgrade, aura and pantheon multipliers', () => {
    const f = fixture(); f.upgrade('Sacrilegious corruption', 1, { bought: 1 });
    f.upgrade('Wrinklerspawn', 1, { bought: 1 }); f.g.auraMult = () => 1; f.g.hasGod = () => 1;
    const expected = 100 * 1.1 * 3 * 1.05 * 1.05 * 1.2 * 1.15;
    assert.ok(Math.abs(O.wrinklerPayout(f.g, { phase: 2, sucked: 100, type: 1 }) - expected) < 1e-9);
  });
  test('ROI includes eventual wrinkler returns while spending income remains separate', () => {
    const f = fixture(); f.building('Grandma', 100, 1000, 1); f.calculate();
    f.g.cpsSucked = 0.5;
    f.g.wrinklers = Array.from({ length: 10 }, () => ({ phase: 2, hp: 10, sucked: 0, type: 0 }));
    const result = O.probe(f.g);
    assert.equal(result.spendable, 50);
    assert.ok(Math.abs(result.deferred - 550) < 1e-9);
    assert.ok(Math.abs(result.income - 600) < 1e-9);
  });
  test('heavenly purchases enforce parents, hidden conditions and currency', () => {
    const f = fixture(); f.g.heavenlyChips = 10;
    const root = f.upgrade('Root', 1, { pool: 'prestige' });
    const child = f.upgrade('Child', 2, { pool: 'prestige', parents: [root] });
    const hidden = f.upgrade('Hidden', 1, { pool: 'prestige', showIf: () => false });
    assert.ok(!O.heavenlyAvailable(f.g, child));
    O.buyHeavenly(f.g); assert.equal(child.bought, 1); assert.equal(hidden.bought, 0); assert.equal(f.g.heavenlyChips, 7);
  });
  test('heavenly path deduplicates shared ancestors and rejects cyclic graphs', () => {
    const f = fixture(); const a = f.upgrade('A', 1, { pool: 'prestige' });
    const b = f.upgrade('B', 1, { pool: 'prestige', parents: [a] });
    const c = f.upgrade('C', 1, { pool: 'prestige', parents: [a, b] });
    assert.equal(O.heavenlyPath(f.g, c).length, 3);
    a.parents = [c]; assert.equal(O.heavenlyPath(f.g, c), null);
  });
  test('permanent-slot buying never leaves a manual selector open', () => {
    const f = fixture(); f.g.heavenlyChips = 100;
    const activation = () => { f.g.promptOn = 1; };
    const slot = f.upgrade('Permanent upgrade slot I', 100, { pool: 'prestige', activateFunction: activation });
    O.buyHeavenly(f.g); assert.equal(slot.bought, 1); assert.equal(f.g.promptOn, 0); assert.equal(slot.activateFunction, activation);
  });
  test('permanent slots contain only eligible owned upgrades without duplicates', () => {
    const f = fixture();
    f.upgrade('Permanent upgrade slot I', 1, { pool: 'prestige', bought: 1 });
    f.upgrade('Permanent upgrade slot II', 1, { pool: 'prestige', bought: 1 });
    const kitten = f.upgrade('Kitten', 1e9, { kitten: 1, bought: 1 });
    f.upgrade('NoPerm', 1e30, { bought: 1, noPerm: 1 });
    const normal = f.upgrade('Cookie', 1e8, { bought: 1, pool: 'cookie' });
    O.assignPermanent(f.g); assert.deepEqual(f.g.permanentUpgrades.slice(0, 2), [kitten.id, normal.id]);
  });
  test('click loop never bursts after a long background stall', () => {
    const f = fixture(); const e = engineFor(f, { autoAscend: false });
    e.fastTick(); f.advance(60000); e.fastTick(); assert.equal(f.g.cookieClicks, 2);
  });
  test('pause, prompts and challenges prevent automatic game actions', () => {
    const f = fixture(); const e = engineFor(f, { enabled: false });
    e.fastTick(); e.slowTick(); assert.equal(f.g.cookieClicks, 0);
    e.setConfig({ enabled: true }); f.g.promptOn = 1; e.fastTick(); e.slowTick(); assert.equal(f.g.cookieClicks, 0);
    f.g.promptOn = 0; f.g.ascensionMode = 1; e.fastTick(); e.slowTick(); assert.equal(f.g.cookieClicks, 0);
  });
  test('shimmer collection handles mutation of the live shimmer array', () => {
    const f = fixture(); const e = engineFor(f);
    f.g.shimmers = ['golden', 'reindeer'].map(type => ({ type, pop() { f.events.push(type); f.g.shimmers.splice(f.g.shimmers.indexOf(this), 1); } }));
    e.fastTick(); assert.deepEqual(f.events, ['golden', 'reindeer']);
  });
  test('wrath-cookie setting is independent from golden-cookie setting', () => {
    const f = fixture(); const e = engineFor(f, { collectWrath: false });
    f.g.shimmers = [{ type: 'golden', wrath: 1, pop: () => f.events.push('wrath') }];
    e.fastTick(); assert.deepEqual(f.events, []);
  });
  test('countdown can be cancelled before any destructive action', () => {
    const f = fixture(); f.g.cookiesEarned = 500 ** 3 * 1e12;
    const e = engineFor(f); e.slowTick(); assert.equal(e.pending.stage, 'countdown'); assert.deepEqual(f.events, []);
    e.setConfig({ autoAscend: false }); e.slowTick(); assert.equal(e.pending, null); assert.deepEqual(f.events, []);
  });
  test('failed backup blocks wrinkler collection, selling and ascension', () => {
    const f = fixture(); f.building('Cursor', 5, 1, 1); f.calculate(); f.g.cookiesEarned = 500 ** 3 * 1e12;
    const storage = memoryStorage(); const e = engineFor(f, { ascendCountdownSeconds: 0 }, storage);
    storage.setItem = (key, value) => { if (key.endsWith(':backups')) throw Error('quota'); storage.values.set(key, value); };
    e.slowTick(); assert.ok(e.state.status.includes('quota')); assert.deepEqual(f.events, []); assert.equal(f.g.ObjectsById[0].amount, 5);
  });
  test('slow errors pause after three failures despite successful fast ticks', () => {
    const f = fixture(); const e = engineFor(f, { autoAscend: false }); f.g.CalculateGains = () => { throw Error('incompatible'); };
    for (let i = 0; i < 3; i++) { e.slowTick(); e.fastTick(); }
    assert.equal(e.config.enabled, false);
  });
  test('ascension waits for wrinkler payout, then sells, buys egg, ascends and reincarnates', () => {
    const f = fixture(); const b = f.building('Cursor', 5, 1, 1);
    f.upgrade('Chocolate egg', 1); f.g.cookiesEarned = 500 ** 3 * 1e12; f.calculate();
    f.g.wrinklers = [{ phase: 2, sucked: 100, hp: 10, type: 1 }];
    const e = engineFor(f, { ascendCountdownSeconds: 0 });
    e.slowTick(); assert.equal(e.getBackups().length, 1); assert.equal(b.amount, 5);
    e.slowTick(); assert.ok(!f.events.includes('ascend'));
    f.g.wrinklers[0].phase = 0; e.slowTick();
    assert.ok(f.events.indexOf('sell:Cursor') < f.events.indexOf('upgrade:Chocolate egg'));
    assert.ok(f.events.indexOf('upgrade:Chocolate egg') < f.events.indexOf('ascend'));
    f.g.AscendTimer = 0; f.g.OnAscend = 1; e.slowTick(); assert.ok(f.events.includes('reincarnate'));
    f.g.ReincarnateTimer = 0; e.setConfig({ autoAscend: false }); e.slowTick(); assert.equal(e.pending, null);
  });
  test('manual ascension is left for the player to manage', () => {
    const f = fixture(); const e = engineFor(f); f.g.OnAscend = 1; e.slowTick();
    assert.ok(!f.events.includes('reincarnate')); assert.ok(e.state.status.includes('手動'));
  });
  test('pending ascension resumes across script reloads', () => {
    const f = fixture(); const storage = memoryStorage(); f.g.cookiesEarned = 500 ** 3 * 1e12;
    const e = engineFor(f, { ascendCountdownSeconds: 0 }, storage); e.slowTick(); e.slowTick();
    f.g.AscendTimer = 0; f.g.OnAscend = 1;
    const reloaded = O.createEngine(f.g, { now: f.now, storage }); reloaded.slowTick(); assert.ok(f.events.includes('reincarnate'));
  });
  test('switching to a different bakery cancels its predecessor pending state', () => {
    const f = fixture(); f.g.cookiesEarned = 500 ** 3 * 1e12; const e = engineFor(f); e.slowTick();
    f.g.fullDate++; f.g.cookiesEarned = 0; e.slowTick(); assert.equal(e.pending, null);
  });
  test('backup ring retains the last three complete export strings', () => {
    const f = fixture(); const e = engineFor(f);
    for (let i = 0; i < 5; i++) { f.advance(1); e.backup(); }
    assert.equal(e.getBackups().length, 3); assert.equal(e.getBackups()[0].createdAt, f.now());
  });
  test('ripe lump harvesting does not spend lumps or harvest too early', () => {
    const f = fixture(); const e = engineFor(f, { autoAscend: false, autoBuy: false });
    f.g.canLumps = () => true; f.g.lumpT = f.now() - 5000; f.g.lumpRipeAge = 10000; f.g.lumpOverripeAge = 20000;
    f.g.clickLump = () => f.events.push('harvest');
    e.setConfig({ autoBuy: true }); e.slowTick(); assert.ok(!f.events.includes('harvest'));
    f.advance(5000); e.slowTick(); assert.ok(f.events.includes('harvest'));
  });
  test('spell uses natural cast cost/failure path only during a productive buff', () => {
    const f = fixture(); const e = engineFor(f, { autoAscend: false, autoBuy: false });
    const spell = {}; f.g.Objects['Wizard tower'] = { minigame: {
      spells: { 'hand of fate': spell }, magic: 100, magicM: 100,
      getSpellCost: () => 50, getFailChance: () => 0.15,
      castSpell: received => { assert.equal(received, spell); f.events.push('cast'); return true; },
    } };
    e.slowTick(); assert.ok(!f.events.includes('cast'));
    f.advance(5000); f.g.buffs.Frenzy = { multCpS: 7, time: 1000 }; e.slowTick(); assert.ok(f.events.includes('cast'));
  });
  test('dragon training pays cookies or sacrifices and replaces real buildings', () => {
    const f = fixture(); const b = f.building('Cursor', 100, 1, 1e6);
    f.upgrade('How to bake your dragon', 9, { pool: 'prestige', bought: 1 });
    f.g.dragonLevel = 5; f.g.dragonLevels = Array.from({ length: 8 }, () => ({ cost: () => true }));
    f.g.UpgradeDragon = () => { b.sacrifice(100); f.g.dragonLevel++; };
    f.calculate(); const before = f.g.cookies;
    const e = engineFor(f, { autoDragon: true, autoAscend: false }); e.slowTick();
    assert.ok(f.events.includes('sacrifice:Cursor:100')); assert.ok(b.amount >= 100); assert.ok(f.g.cookies < before);
  });

  for (const { name, error } of failures) console.error(`FAIL ${name}\n${error.stack}`);
  console.log(`${passed} passed, ${failures.length} failed`);
  return { passed, failed: failures.length };
}

module.exports = run;
if (require.main === module) process.exitCode = run().failed ? 1 : 0;
