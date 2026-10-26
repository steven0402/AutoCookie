'use strict';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values,
  };
}

function fixture() {
  let time = 1800000000000;
  const events = [];
  const g = {
    ready: true, version: 'fixture', SaveTo: 'CookieClickerGame',
    cookies: 1000, cookiesEarned: 0, cookiesReset: 0, prestige: 0,
    fullDate: time - 7200000, startDate: time - 3600000,
    BuildingsOwned: 0, UpgradesOwned: 0, cookieClicks: 0,
    cookiesPs: 0, cookiesPsRaw: 0, cookiesPsRawHighest: 0,
    computedMouseCps: 1, unbuffedCps: 0, buildingCps: 0,
    globalCpsMult: 1, cpsSucked: 0, recalculateGains: 0,
    cookiesPsByType: {}, cookiesMultByType: {}, effs: {}, buffs: {},
    Objects: {}, ObjectsById: [], Upgrades: {}, UpgradesById: [],
    UpgradesInStore: [], PrestigeUpgrades: [], permanentUpgrades: [-1, -1, -1, -1, -1],
    Tiers: {}, vault: [], shimmers: [], wrinklers: [],
    buyMode: 1, buyBulk: 1, ascensionMode: 0, nextAscensionMode: 0,
    OnAscend: 0, AscendTimer: 0, ReincarnateTimer: 0, promptOn: 0,
    heavenlyChips: 0, heavenlyChipsSpent: 0, fps: 30,
    Win: name => events.push(`achievement:${name}`),
    computeLumpTimes: () => events.push('compute-lump-times'),
    runModHook: () => events.push('mod-hook'),
    runModHookOnValue: (_name, value) => value,
    CountsAsUpgradeOwned: pool => ['', 'cookie', 'tech'].includes(pool),
    HowMuchPrestige: cookies => Math.cbrt(cookies / 1e12),
    WriteSave: () => 'encoded-save-string-for-fixture-!END!',
    CollectWrinklers() { events.push('collect-wrinklers'); for (const w of g.wrinklers) w.hp = 0; },
    BuildAscendTree() { events.push('build-tree'); },
    Ascend() { events.push('ascend'); g.AscendTimer = 1; },
    Reincarnate() { events.push('reincarnate'); g.OnAscend = 0; g.startDate = time; g.ReincarnateTimer = 1; },
    ClickCookie() { g.cookieClicks++; g.cookies += g.computedMouseCps; },
    canLumps: () => false,
    CalculateGains() {
      let cps = 0;
      for (const b of g.ObjectsById) {
        b.storedCps = b.baseCps;
        for (const u of b.tieredUpgrades) if (u.bought) b.storedCps *= u.mult || 2;
        b.storedTotalCps = b.amount * b.storedCps;
        cps += b.storedTotalCps;
        g.cookiesPsByType[b.name] = b.storedTotalCps;
      }
      for (const u of g.UpgradesById) if (u.bought && u.gainMult) cps *= u.gainMult;
      if (g.testGain) cps = g.testGain(cps);
      g.effs = { cps: 1 };
      g.cookiesMultByType.kittens = 1;
      g.cookiesPsRawHighest = Math.max(g.cookiesPsRawHighest, cps);
      g.cookiesPsRaw = cps;
      g.unbuffedCps = cps;
      for (const buff of Object.values(g.buffs)) cps *= buff.multCpS || 1;
      g.cookiesPs = cps;
      g.computedMouseCps = 1;
      for (const u of g.UpgradesById) if (u.bought && u.clickMult) g.computedMouseCps *= u.clickMult;
      for (const buff of Object.values(g.buffs)) g.computedMouseCps *= buff.multClick || 1;
      g.Win('hypothetical-cps');
      g.runModHook('test');
      g.computeLumpTimes();
      g.recalculateGains = 0;
    },
  };
  function building(name, amount, price, cps) {
    const b = {
      id: g.ObjectsById.length, name, dname: name, amount, bought: amount,
      highest: amount, basePrice: price, baseCps: cps, free: 0, level: 0,
      tieredUpgrades: [], storedCps: cps, storedTotalCps: cps * amount,
      getPrice() { return Math.ceil(price * Math.pow(1.15, b.amount - amount)); },
      buy(count = 1) {
        if (g.buyMode === -1) return b.sell(g.buyBulk);
        for (let i = 0; i < count; i++) {
          const cost = b.getPrice();
          if (g.cookies < cost) break;
          g.cookies -= cost; b.amount++; b.bought++; g.BuildingsOwned++;
          g.recalculateGains = 1; events.push(`buy:${name}`);
        }
      },
      sell(count) { events.push(`sell:${name}`); b.amount -= count; g.BuildingsOwned -= count; g.cookies += count; },
      sacrifice(count) { events.push(`sacrifice:${name}:${count}`); b.amount -= count; g.BuildingsOwned -= count; },
    };
    g.Objects[name] = b; g.ObjectsById.push(b); g.BuildingsOwned += amount;
    return b;
  }
  function upgrade(name, price, extra = {}) {
    const u = {
      id: g.UpgradesById.length, name, dname: name, pool: '', bought: 0,
      unlocked: 1, basePrice: price, parents: [], getPrice: () => price,
      ...extra,
      buy() {
        const currency = u.pool === 'prestige' ? 'heavenlyChips' : 'cookies';
        if (u.bought || g[currency] < u.getPrice()) return 0;
        g[currency] -= u.getPrice(); u.bought = 1; u.unlocked = 1;
        if (g.CountsAsUpgradeOwned(u.pool)) g.UpgradesOwned++;
        g.recalculateGains = 1; events.push(`upgrade:${name}`);
        if (u.buyFunction) u.buyFunction();
        if (u.activateFunction) u.activateFunction();
        return 1;
      },
    };
    g.Upgrades[name] = u; g.UpgradesById.push(u);
    if (u.pool === 'prestige') g.PrestigeUpgrades.push(u);
    else if (u.unlocked && !u.bought) g.UpgradesInStore.push(u);
    if (u.bought && g.CountsAsUpgradeOwned(u.pool)) g.UpgradesOwned++;
    return u;
  }
  function calculate() { g.CalculateGains(); events.length = 0; }
  return { g, events, building, upgrade, calculate, now: () => time, advance: ms => { time += ms; } };
}

module.exports = { fixture, memoryStorage };
