// ==UserScript==
// @name         Cookie Clicker 自然成長助手
// @namespace    local.cookie-optimizer
// @version      1.0.1
// @description  依增量收益與等待時間購買，收集金餅，管理升天與重生。使用正常遊戲成本。
// @match        https://orteil.dashnet.org/cookieclicker/*
// @match        http://orteil.dashnet.org/cookieclicker/*
// @match        https://cdn.dashnet.org/cookieclicker/*
// @match        http://cdn.dashnet.org/cookieclicker/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function (root, factory) {
  'use strict';
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else lib.install(root);
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  const VERSION = '1.0.1';
  const DEFAULTS = Object.freeze({
    enabled: true,
    autoClick: true,
    clicksPerSecond: 20,
    autoBuy: true,
    collectGolden: true,
    collectWrath: true,
    collectReindeer: true,
    autoSpell: true,
    harvestLumps: true,
    autoResearch: true,
    // One mind keeps natural golden cookies available while permitting wrinklers.
    grandmapocalypse: 'oneMind',
    autoSanta: true,
    autoDragon: true,
    reserveMode: 'smart',
    reserveSeconds: 0,
    maxWaitSeconds: 900,
    maxBundle: 25,
    autoAscend: true,
    firstAscendChips: 440,
    prestigeGainRatio: 1,
    minRunMinutes: 15,
    ascendCountdownSeconds: 10,
    sellBeforeAscend: true,
    autoHeavenly: true,
    autoPermanentSlots: true,
    collapsed: false,
  });

  const STRATEGIC = Object.freeze({
    'Lucky day': 0.08,
    Serendipity: 0.08,
    'Get lucky': 0.15,
    'Heavenly chip secret': 0.02,
    'Heavenly cookie stand': 0.02,
    'Heavenly bakery': 0.02,
    'Heavenly confectionery': 0.02,
    'Heavenly key': 0.02,
    'A festive hat': 0.04,
    'How to bake your dragon': 0.03,
    'Season savings': 0.01,
    'Toy workshop': 0.01,
    'Faberge egg': 0.01,
    Omelette: 0.005,
    'Golden goose egg': 0.005,
    'Santa\'s bottomless bag': 0.005,
    'Santa\'s bag': 0.005,
    'Santa\'s wonderland': 0.005,
    'Santa\'s gift': 0.005,
    'Chocolate egg': 0,
  });

  // The initial package through Starter kit costs 440 chips in the reference build.
  const HEAVENLY_PRIORITY = Object.freeze([
    'Legacy', 'Heavenly cookies', 'How to bake your dragon',
    'Permanent upgrade slot I', 'Heralds', 'Heavenly luck',
    'Box of brand biscuits', 'Tin of british tea biscuits',
    'Box of macarons', 'Tin of butter cookies', 'Starter kit',
    'Persistent memory', 'Lasting fortune', 'Decisive fate',
    'Golden switch', 'Lucky digit', 'Lucky number', 'Lucky payout',
    'Divine discount', 'Divine sales', 'Divine bakeries',
    'Permanent upgrade slot II', 'Starter kitchen',
    'Inspired checklist', 'Label printer',
    'Sugar baking', 'Sugar craving', 'Sugar aging process',
    'Permanent upgrade slot III', 'Permanent upgrade slot IV',
    'Permanent upgrade slot V',
  ]);

  const GAME_GAIN_FIELDS = [
    'cookiesPs', 'cookiesPsRaw', 'cookiesPsRawHighest', 'unbuffedCps',
    'computedMouseCps', 'globalCpsMult', 'buildingCps', 'cpsSucked',
    'recalculateGains', 'BuildingsOwned', 'UpgradesOwned', 'cookies',
    'milkProgress', 'heavenlyPower', 'dragonAura', 'dragonAura2',
    'effs', 'buffs', 'Win', 'computeLumpTimes', 'runModHook', 'runModHookOnValue',
  ];

  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const owns = (g, name) => Boolean(g.Upgrades && g.Upgrades[name] && g.Upgrades[name].bought);
  const positiveBuffs = g => Object.values(g.buffs || {}).some(b => b.multCpS > 1 || b.multClick > 1);
  const inAnimation = g => Boolean(g.AscendTimer > 0 || g.ReincarnateTimer > 0);
  const eligiblePool = u => u.pool === '' || u.pool === 'cookie' || u.pool === 'tech';
  const vaulted = (g, u) => (g.vault || []).includes(u.id) || Boolean(u.isVaulted && u.isVaulted());

  function wrinklerPayout(g, w) {
    if (!(w.phase > 0) || !(w.sucked > 0)) return 0;
    let mult = 1.1 * (w.type === 1 ? 3 : 1);
    if (owns(g, 'Sacrilegious corruption')) mult *= 1.05;
    if (owns(g, 'Wrinklerspawn')) mult *= 1.05;
    mult *= 1 + number(g.auraMult?.('Dragon Guts')) * 0.2;
    const scorn = g.hasGod?.('scorn');
    if (scorn >= 1 && scorn <= 3) mult *= [1, 1.15, 1.1, 1.05][scorn];
    return w.sucked * mult;
  }

  function sanitize(input = {}) {
    const out = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (typeof DEFAULTS[key] === 'boolean' && typeof input[key] === 'boolean') out[key] = input[key];
    }
    for (const [key, lo, hi] of [
      ['clicksPerSecond', 1, 40], ['reserveSeconds', 0, 86400],
      ['maxWaitSeconds', 1, 86400], ['maxBundle', 1, 100],
      ['firstAscendChips', 1, 1e15], ['prestigeGainRatio', 0.1, 100],
      ['minRunMinutes', 1, 10080], ['ascendCountdownSeconds', 0, 300],
    ]) out[key] = clamp(number(input[key], DEFAULTS[key]), lo, hi);
    out.maxBundle = Math.floor(out.maxBundle);
    out.firstAscendChips = Math.ceil(out.firstAscendChips);
    if (['off', 'smart', 'always'].includes(input.reserveMode)) out.reserveMode = input.reserveMode;
    if (['off', 'oneMind', 'full'].includes(input.grandmapocalypse)) out.grandmapocalypse = input.grandmapocalypse;
    return out;
  }

  function capture(object, keys) {
    const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(object, key)]);
    return () => {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(object, key, descriptor);
        else delete object[key];
      }
    };
  }

  /** A synchronous, reversible probe. Never executes a purchase or its buyFunction. */
  function probe(g, changes = [], clickRate = 0, stable = true) {
    const restoreGame = capture(g, GAME_GAIN_FIELDS);
    const restoreObjects = (g.ObjectsById || []).map(b => capture(b, [
      'amount', 'bought', 'highest', 'storedCps', 'storedTotalCps',
    ]));
    const restoreUpgrades = changes.filter(c => c.upgrade).map(c => capture(c.upgrade, ['bought']));
    const maps = ['cookiesPsByType', 'cookiesMultByType'].map(key => ({
      key, descriptor: Object.getOwnPropertyDescriptor(g, key),
      ref: g[key], copy: { ...(g[key] || {}) },
    }));
    try {
      // CalculateGains normally awards CpS achievements and recomputes lump times.
      // Do not run third-party hooks during hypothetical calculations.
      g.Win = () => {};
      g.computeLumpTimes = () => {};
      g.runModHook = () => {};
      g.runModHookOnValue = (_hook, value) => value;
      if (stable) g.buffs = {};
      for (const change of changes) {
        if (change.building) {
          const b = change.building;
          b.amount += change.count;
          b.bought += change.count;
          b.highest = Math.max(number(b.highest), b.amount);
          g.BuildingsOwned += change.count;
        }
        if (change.upgrade) {
          const u = change.upgrade;
          const next = change.bought === undefined ? 1 : change.bought;
          const old = u.bought;
          u.bought = next;
          if (!g.CountsAsUpgradeOwned || g.CountsAsUpgradeOwned(u.pool)) g.UpgradesOwned += next - old;
        }
        if (change.aura !== undefined) g[change.slot === 1 ? 'dragonAura2' : 'dragonAura'] = change.aura;
      }
      g.CalculateGains();
      const passive = Math.max(0, number(g.cookiesPs));
      const sucked = clamp(number(g.cpsSucked), 0, 1);
      const spendable = passive * (1 - sucked);
      // Each feeding wrinkler stores the entire sucked share, not a divided share.
      const payoutMultiplier = (g.wrinklers || []).filter(w => w.phase === 2 && w.hp > 0)
        .reduce((sum, w) => sum + wrinklerPayout(g, { ...w, sucked: 1 }), 0);
      const deferred = passive * sucked * payoutMultiplier;
      const click = Math.max(0, number(g.computedMouseCps)) * clickRate;
      return { income: spendable + click + deferred, passive, spendable, deferred, click };
    } finally {
      for (const restore of restoreUpgrades.reverse()) restore();
      for (const restore of restoreObjects) restore();
      for (const { key, descriptor, ref, copy } of maps) {
        if (ref && typeof ref === 'object') {
          for (const entry of Object.keys(ref)) delete ref[entry];
          Object.assign(ref, copy);
        }
        if (descriptor) Object.defineProperty(g, key, descriptor);
        else delete g[key];
      }
      restoreGame();
    }
  }

  // getSumPrice rounds once; real buys round each building. Sum actual getPrice calls.
  function buildingPrice(b, count, offset = 0) {
    const initial = b.amount;
    let price = 0;
    try {
      b.amount += offset;
      for (let i = 0; i < count; i++) {
        price += number(b.getPrice(), Infinity);
        b.amount++;
      }
      return price;
    } finally { b.amount = initial; }
  }

  function buyBuilding(g, b, count) {
    const mode = g.buyMode;
    const bulk = g.buyBulk;
    const before = b.amount;
    try {
      g.buyMode = 1;
      g.buyBulk = 1;
      b.buy(count);
      return b.amount > before;
    } finally {
      g.buyMode = mode;
      g.buyBulk = bulk;
    }
  }

  function allowedUpgrade(g, u, config, allowLocked = false) {
    if (!u || u.bought || (!allowLocked && !u.unlocked) || !eligiblePool(u)) return false;
    if (u.priceLumps > 0 || u.choicesFunction || vaulted(g, u) || u.name === 'Chocolate egg') return false;
    if (u.pool === 'tech' && !config.autoResearch) return false;
    if (u.name === 'Bingo center/Research facility' && !config.autoResearch) return false;
    const stages = ['One mind', 'Communal brainsweep', 'Elder Pact'];
    if (stages.includes(u.name)) {
      if (config.grandmapocalypse === 'off') return false;
      if (config.grandmapocalypse === 'oneMind' && u.name !== 'One mind') return false;
    }
    // Unknown click handlers may open a selector or require a non-cookie resource.
    if (u.clickFunction && u.name !== 'One mind') return false;
    return true;
  }

  function reserveFor(g, config, passive, payback = Infinity) {
    let reserve = passive * config.reserveSeconds;
    const keepLucky = config.reserveMode === 'always' || (
      config.reserveMode === 'smart' && owns(g, 'Get lucky') && payback > 600
    );
    if (keepLucky && config.collectGolden) reserve = Math.max(reserve, passive * 6000 * (owns(g, 'Get lucky') ? 7 : 1));
    return reserve;
  }

  function plan(g, config, clickRate) {
    const base = probe(g, [], clickRate);
    const liveIncome = Math.max(0, number(g.cookiesPs) * (1 - number(g.cpsSucked)) + number(g.computedMouseCps) * clickRate);
    const candidates = [];
    const evaluate = (candidate, strategic = 0) => {
      if (!Number.isFinite(candidate.price) || candidate.price < 0) return;
      const after = probe(g, candidate.changes, clickRate);
      const delta = after.income - base.income;
      const virtualDelta = Math.max(delta, base.income * strategic);
      if (!(virtualDelta > 0)) return;
      const payback = candidate.price / virtualDelta;
      const reserve = reserveFor(g, config, after.passive, payback);
      const shortfall = Math.max(0, candidate.price + reserve - g.cookies);
      const wait = shortfall === 0 ? 0 : liveIncome > 0 ? shortfall / liveIncome : Infinity;
      if (wait > config.maxWaitSeconds) return;
      candidates.push({ ...candidate, delta, estimated: virtualDelta > delta, payback, reserve, wait, score: wait + payback });
    };
    for (const b of g.ObjectsById || []) {
      if (b.locked || typeof b.getPrice !== 'function') continue;
      evaluate({ kind: 'building', item: b, count: 1, price: buildingPrice(b, 1), changes: [{ building: b, count: 1 }] });
      // Evaluate the complete cost of a nearby building threshold AND its upgrade.
      // The game keys this object by tier; it is not an iterable array.
      for (const u of Object.values(b.tieredUpgrades || {})) {
        const tier = (g.Tiers || {})[u.tier];
        const count = tier ? tier.unlock - b.amount : 0;
        if (count < 1 || count > config.maxBundle || !allowedUpgrade(g, u, config, true)) continue;
        evaluate({
          kind: 'bundle', item: b, upgrade: u, count,
          price: buildingPrice(b, count) + number(u.getPrice(), Infinity),
          changes: [{ building: b, count }, { upgrade: u }],
        });
      }
    }
    for (const u of g.UpgradesInStore || []) {
      if (!allowedUpgrade(g, u, config)) continue;
      evaluate({ kind: 'upgrade', item: u, price: number(u.getPrice(), Infinity), changes: [{ upgrade: u }] }, STRATEGIC[u.name] || 0);
    }
    candidates.sort((a, b) => a.score - b.score || a.price - b.price);
    return { base, liveIncome, candidates, best: candidates[0] || null };
  }

  function ascendInfo(g, config, now) {
    const total = Math.floor(g.HowMuchPrestige(g.cookiesReset + g.cookiesEarned));
    const gain = Math.max(0, total - number(g.prestige));
    const wrinklerCookies = (g.wrinklers || []).reduce((sum, w) => sum + wrinklerPayout(g, w), 0);
    const projectedGain = Math.max(gain, Math.floor(g.HowMuchPrestige(g.cookiesReset + g.cookiesEarned + wrinklerCookies)) - number(g.prestige));
    const target = g.prestige > 0 ? Math.max(1, Math.ceil(g.prestige * config.prestigeGainRatio)) : config.firstAscendChips;
    const ageMinutes = Math.max(0, (now - number(g.startDate, now)) / 60000);
    let reason = '';
    if (g.ascensionMode === 1 || g.nextAscensionMode === 1) reason = '挑戰模式中，暫停自動重生';
    else if (projectedGain < target) reason = `等待天界碎片 ${format(projectedGain)} / ${format(target)}`;
    else if (ageMinutes < config.minRunMinutes) reason = '等待本輪最短時間';
    else if (positiveBuffs(g)) reason = '等待目前的收益加成結束';
    else if ((g.shimmers || []).some(s => !s.popped)) reason = '等待畫面上的金餅或馴鹿';
    return { gain, projectedGain, wrinklerCookies, target, total, ageMinutes, ready: !reason, reason };
  }

  function resolveParent(g, parent) {
    if (typeof parent === 'string') return g.Upgrades[parent];
    if (typeof parent === 'number') return (g.UpgradesById || [])[parent];
    return parent;
  }

  function heavenlyAvailable(g, u) {
    return u && u.pool === 'prestige' && !u.bought && !vaulted(g, u) &&
      (!u.showIf || u.showIf()) &&
      (u.parents || []).every(p => p === -1 || Boolean(resolveParent(g, p)?.bought));
  }

  function heavenlyPath(g, u, seen = new Set()) {
    if (!u || u.bought) return [];
    if (seen.has(u.id) || vaulted(g, u) || (u.showIf && !u.showIf())) return null;
    seen.add(u.id);
    const path = [];
    for (const p of u.parents || []) {
      if (p === -1) continue;
      const parent = resolveParent(g, p);
      if (!parent) return null;
      const branch = heavenlyPath(g, parent, new Set(seen));
      if (branch === null) return null;
      path.push(...branch);
    }
    path.push(u);
    return [...new Set(path)];
  }

  function buyHeavenly(g) {
    const all = (g.PrestigeUpgrades || []).filter(u => u.pool === 'prestige');
    const targets = [...new Set([
      ...HEAVENLY_PRIORITY.map(name => g.Upgrades[name]).filter(Boolean),
      ...all.slice().sort((a, b) => a.getPrice() - b.getPrice()),
    ])];
    const bought = [];
    for (const target of targets) {
      const path = heavenlyPath(g, target);
      if (!path || path.reduce((sum, u) => sum + u.getPrice(), 0) > g.heavenlyChips) continue;
      for (const u of path) {
        // The game's prestige buy() does NOT enforce parents or showIf itself.
        if (!heavenlyAvailable(g, u) || u.getPrice() > g.heavenlyChips) continue;
        // Slot purchases normally open the manual picker via activateFunction.
        // Defer that picker; assignPermanent handles these slots after purchases.
        const restore = capture(u, ['activateFunction']);
        try {
          if (/^Permanent upgrade slot /.test(u.name)) u.activateFunction = undefined;
          u.buy(1);
        } finally { restore(); }
        if (u.bought) bought.push(u.name);
      }
    }
    return bought;
  }

  function assignPermanent(g) {
    const slots = ['I', 'II', 'III', 'IV', 'V'];
    const candidates = (g.UpgradesById || []).filter(u => u && u.bought && u.unlocked && !u.noPerm &&
      (u.pool === '' || u.pool === 'cookie'));
    const score = u => {
      const price = Math.log10(Math.max(1, number(u.basePrice)));
      if (u.kitten) return 1000 + price;
      if (u.name === 'Get lucky') return 950;
      if (u.buildingTie?.id === 0 && u.tier) return 900 + price;
      if (u.name === 'Serendipity') return 850;
      if (u.name === 'Lucky day') return 800;
      return price;
    };
    candidates.sort((a, b) => score(b) - score(a));
    const selected = new Set();
    const assignments = [];
    for (let i = 0; i < slots.length; i++) {
      if (!owns(g, `Permanent upgrade slot ${slots[i]}`)) continue;
      const u = candidates.find(candidate => !selected.has(candidate.id));
      if (!u) continue;
      // Equivalent to confirming the game's permanent-upgrade selector.
      g.permanentUpgrades[i] = u.id;
      selected.add(u.id);
      assignments.push(u.name);
    }
    if (assignments.length && g.BuildAscendTree) g.BuildAscendTree();
    return assignments;
  }

  function format(value) {
    if (!Number.isFinite(value)) return '—';
    if (Math.abs(value) >= 1e9) return value.toExponential(2);
    return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: value < 100 ? 1 : 0 }).format(value);
  }

  function duration(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    if (seconds < 60) return `${Math.ceil(seconds)} 秒`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)} 分`;
    return `${(seconds / 3600).toFixed(1)} 小時`;
  }

  function createEngine(g, env = {}) {
    const now = env.now || Date.now;
    const storage = env.storage;
    const prefix = env.prefix || 'cookie-optimizer:v1';
    const read = (key, fallback) => {
      try { return JSON.parse(storage?.getItem(`${prefix}:${key}`) || 'null') ?? fallback; }
      catch { return fallback; }
    };
    const write = (key, value, required = false) => {
      try {
        if (!storage) throw new Error('無法使用瀏覽器本機儲存空間');
        storage.setItem(`${prefix}:${key}`, JSON.stringify(value));
        return true;
      } catch (error) {
        if (required) throw new Error(`無法儲存重生備份／進度：${error.message}`);
        return false;
      }
    };
    let config = sanitize(read('config', {}));
    let pending = read('pending', null);
    let lastPlan = null;
    let status = '正在載入';
    let lastAction = '';
    let clickStart = now();
    let clickTimes = [];
    let nextClick = 0;
    let nextShimmer = 0;
    let lastMaintenance = 0;
    const logs = [];
    const log = message => {
      lastAction = message;
      logs.unshift({ time: now(), message });
      logs.length = Math.min(logs.length, 30);
    };
    const persistPending = value => {
      write('pending', value, true);
      pending = value;
    };
    const identity = () => String(g.fullDate);
    const active = () => config.enabled && !g.promptOn && !g.OnAscend && !inAnimation(g) && g.ascensionMode !== 1;
    const clickRate = () => {
      if (!config.autoClick || !config.enabled) return 0;
      const time = now();
      clickTimes = clickTimes.filter(t => time - t <= 10000);
      const elapsed = Math.min(10, (time - clickStart) / 1000);
      return elapsed < 3 ? config.clicksPerSecond : Math.min(config.clicksPerSecond, clickTimes.length / elapsed);
    };
    const backup = (reason = 'manual') => {
      const save = g.WriteSave(1);
      if (typeof save !== 'string' || save.length < 20) throw new Error('遊戲沒有回傳有效的匯出存檔');
      const entry = { createdAt: now(), reason, gameVersion: g.version, prestige: g.prestige, save };
      const backups = read('backups', []);
      write('backups', [entry, ...(Array.isArray(backups) ? backups : []).slice(0, 2)], true);
      return entry;
    };

    function fastTick() {
      if (!active()) return;
      const time = now();
      if (config.autoClick && time >= nextClick) {
        const before = number(g.cookieClicks);
        g.ClickCookie();
        if (number(g.cookieClicks) > before) clickTimes.push(time);
        // No burst of catch-up clicks after a throttled background tab resumes.
        nextClick = time + 1000 / config.clicksPerSecond;
      }
      if (time < nextShimmer) return;
      nextShimmer = time + 200;
      for (const shimmer of [...(g.shimmers || [])]) {
        if (shimmer.popped) continue;
        if (shimmer.type === 'golden' && (shimmer.wrath ? config.collectWrath : config.collectGolden)) shimmer.pop();
        if (shimmer.type === 'reindeer' && config.collectReindeer) shimmer.pop();
      }
      if (g.TickerEffect?.type === 'fortune' && g.tickerL?.click) g.tickerL.click();
    }

    function maintain() {
      if (now() - lastMaintenance < 5000) return;
      lastMaintenance = now();
      if (config.harvestLumps && g.canLumps?.() && now() - g.lumpT >= g.lumpRipeAge && now() - g.lumpT < g.lumpOverripeAge) {
        g.clickLump();
        log('收成已熟糖塊（保留糖塊，不自動消耗）');
      }
      const magic = g.Objects?.['Wizard tower']?.minigame;
      if (config.autoSpell && magic?.spells?.['hand of fate'] && magic.castSpell &&
        magic.magic >= magic.magicM * 0.98 && !(g.shimmers || []).some(s => !s.popped)) {
        const spell = magic.spells['hand of fate'];
        const buffs = Object.values(g.buffs || {});
        const good = buffs.some(b => b.multCpS > 1 && b.time / g.fps >= 5);
        const bad = buffs.some(b => b.multCpS < 1);
        const clicking = buffs.some(b => b.multClick > 1);
        if (good && !bad && !clicking && magic.magic >= magic.getSpellCost(spell) && magic.getFailChance(spell) <= 0.25) {
          if (magic.castSpell(spell)) log('在產量加成期間施放命運之手（保留原有失敗機率）');
        }
      }
    }

    function specials(base) {
      const income = Math.max(base.income, 1);
      const reserve = reserveFor(g, config, base.passive);
      if (config.autoSanta && owns(g, 'A festive hat') && g.santaLevel < 14 && g.UpgradeSanta) {
        const cost = Math.pow(g.santaLevel + 1, g.santaLevel + 1);
        if (cost + reserve < g.cookies && cost / income <= 120) {
          g.UpgradeSanta();
          log(`聖誕老人升至 ${g.santaLevel} 級`);
          return true;
        }
      }
      if (!config.autoDragon || !owns(g, 'How to bake your dragon') || !g.dragonLevels || positiveBuffs(g)) return false;
      const level = g.dragonLevel;
      if (level < g.dragonLevels.length - 1 && g.dragonLevels[level].cost()) {
        let cost = 0;
        let sacrifices = [];
        if (level < 5) cost = 1e6 * Math.pow(2, level);
        else if (level - 5 < (g.ObjectsById || []).length) sacrifices = [{ b: g.ObjectsById[level - 5], n: 100 }];
        else if (level === g.dragonLevels.length - 3) sacrifices = g.ObjectsById.map(b => ({ b, n: 50 }));
        else if (level === g.dragonLevels.length - 2) sacrifices = g.ObjectsById.map(b => ({ b, n: 200 }));
        else return false; // Unknown future dragon level: do not guess its sacrifice.
        cost += sacrifices.reduce((sum, { b, n }) => sum + buildingPrice(b, n, -n), 0);
        if (cost + reserve <= g.cookies && cost / income <= 120) {
          g.UpgradeDragon();
          for (const { b, n } of sacrifices) buyBuilding(g, b, n);
          log(`訓練龍至 ${g.dragonLevel} 級，補回祭獻建築`);
          return true;
        }
      }
      // Compare sustained production auras. Omit on-screen-cookie and RNG auras.
      const choices = [0, 1, 2, 3, 8, 15, 18, 21].filter(id => g.dragonAuras?.[id] && g.dragonLevel >= id + 4);
      const slots = g.dragonLevel >= g.dragonLevels.length - 1 ? [0, 1] : [0];
      const top = [...(g.ObjectsById || [])].reverse().find(b => b.amount > 0);
      const cost = top ? buildingPrice(top, 1, -1) : 0;
      let best = null;
      for (const slot of slots) {
        const current = slot ? g.dragonAura2 : g.dragonAura;
        const other = slot ? g.dragonAura : g.dragonAura2;
        for (const aura of choices) {
          if (aura === current || (aura !== 0 && aura === other)) continue;
          const delta = probe(g, [{ aura, slot }], clickRate()).income - base.income;
          if (delta > 0 && cost / delta <= 600 && (!best || delta > best.delta)) best = { aura, slot, delta };
        }
      }
      if (best && cost * 1.1 + reserve <= g.cookies) {
        // These are the same operations as the game's aura-selector Confirm button.
        if (top) top.sacrifice(1);
        g[best.slot ? 'dragonAura2' : 'dragonAura'] = best.aura;
        g.recalculateGains = 1;
        if (top) buyBuilding(g, top, 1);
        log(`龍光環改為 ${g.dragonAuras[best.aura].name}，支付祭獻成本`);
        return true;
      }
      return false;
    }

    function ascensionStep() {
      const time = now();
      if (pending && pending.identity !== identity()) {
        persistPending(null);
        log('已切換存檔，取消先前的重生程序');
      }
      if (pending && !g.OnAscend && !inAnimation(g) && Number(g.startDate) !== pending.startDate) {
        persistPending(null);
        log('重生完成，恢復成長');
      }
      if (g.OnAscend) {
        if (!pending) { status = '目前為手動升天，等待你的操作'; return true; }
        if (!config.autoAscend) { status = '重生程序已暫停'; return true; }
        if (g.nextAscensionMode === 1) { status = '已選擇挑戰模式，停止自動重生'; return true; }
        if (config.autoHeavenly) {
          const bought = buyHeavenly(g);
          if (bought.length) log(`購買 ${bought.length} 項天界升級`);
        }
        if (config.autoPermanentSlots) {
          const assigned = assignPermanent(g);
          if (assigned.length) log(`永久欄位：${assigned.join('、')}`);
        }
        persistPending({ ...pending, stage: 'reincarnating' });
        g.Reincarnate(1);
        status = '正在重生';
        return true;
      }
      if (inAnimation(g)) { status = '等待升天／重生動畫'; return true; }
      if (!config.autoAscend) {
        // No destructive operations have happened during the countdown.
        if (pending?.stage === 'countdown') persistPending(null);
        if (pending) status = '重生程序已暫停，可下載重生前備份';
        return Boolean(pending);
      }
      const info = ascendInfo(g, config, time);
      if (!pending) {
        if (!info.ready) return false;
        persistPending({ identity: identity(), startDate: Number(g.startDate), stage: 'countdown', due: time + config.ascendCountdownSeconds * 1000 });
        log(`達到重生目標，${config.ascendCountdownSeconds} 秒後開始`);
      }
      if (pending.stage === 'countdown') {
        if (!info.ready) {
          persistPending(null);
          status = info.reason;
          return false;
        }
        status = `重生倒數 ${Math.max(0, Math.ceil((pending.due - time) / 1000))} 秒（可暫停）`;
        if (time < pending.due) return true;
        // Both the original save and recovery state must be durable BEFORE selling.
        backup('before-ascend');
        persistPending({ ...pending, stage: 'collecting' });
        g.CollectWrinklers();
        return true;
      }
      if (pending.stage === 'collecting') {
        const wrinklers = (g.wrinklers || []).filter(w => w.phase > 0 && w.sucked > 0);
        if (wrinklers.length) {
          g.CollectWrinklers();
          status = '等待皺皮蟲的收益入帳';
          return true;
        }
        // Do not dismantle the bakery if a new combo appeared during collection.
        if (positiveBuffs(g) || (g.shimmers || []).some(s => !s.popped)) {
          status = '等待收成期間出現的加成結束';
          return true;
        }
        persistPending({ ...pending, stage: 'ascending' });
        if (config.sellBeforeAscend) for (const b of g.ObjectsById || []) if (b.amount > 0) b.sell(b.amount, 1);
        const egg = g.Upgrades['Chocolate egg'];
        if (egg?.unlocked && !egg.bought && !vaulted(g, egg) && egg.getPrice() <= g.cookies) egg.buy(1);
        g.Ascend(1);
        log(`升天，預計取得 ${format(ascendInfo(g, config, time).gain)} 碎片`);
        return true;
      }
      if (pending.stage === 'ascending') {
        // Resume a page reload between persisting the state and finishing animation.
        g.Ascend(1);
        status = '繼續升天';
        return true;
      }
      if (pending.stage === 'reincarnating') {
        // A successful Reset changes startDate; the check above clears this state.
        persistPending(null);
      }
      return false;
    }

    function slowTick() {
      if (!config.enabled) { status = '已暫停'; return; }
      if (g.promptOn) { status = '等待遊戲對話框關閉'; return; }
      if (ascensionStep()) return;
      if (!active()) { status = '挑戰模式中，等待你的操作'; return; }
      maintain();
      if (g.recalculateGains) g.CalculateGains();
      if (!config.autoBuy) { status = '自動購買已關閉'; return; }
      // Re-plan after each purchase, so kitten/synergy effects change the next choice.
      for (let i = 0; i < 5; i++) {
        lastPlan = plan(g, config, clickRate());
        if (i === 0 && specials(lastPlan.base)) {
          if (g.recalculateGains) g.CalculateGains();
          continue;
        }
        const best = lastPlan.best;
        if (!best) { status = '持續累積，暫無合適的投資'; break; }
        const name = best.item.dname || best.item.name;
        const label = best.kind === 'bundle' ? `${name} ×${best.count} → ${best.upgrade.dname || best.upgrade.name}` : `${name}${best.count > 1 ? ` ×${best.count}` : ''}`;
        if (best.wait > 0) {
          // Once the pack is full, a single large regular wrinkler can fund an
          // otherwise slow investment. Keep shiny wrinklers until ascension.
          const pack = (g.wrinklers || []).filter(w => w.phase === 2 && w.hp > 0);
          const fullPack = pack.length >= number(g.getWrinklersMax?.(), 10);
          const needed = best.price + best.reserve - g.cookies;
          const funder = pack.filter(w => w.type !== 1 && wrinklerPayout(g, w) >= needed)
            .sort((a, b) => b.sucked - a.sucked)[0];
          if (fullPack && best.wait >= 300 && funder && !positiveBuffs(g)) {
            funder.hp = 0;
            log('收割一隻普通皺皮蟲，支應下一筆投資');
          }
          status = `儲蓄：${label}（約 ${duration(best.wait)}）`; break;
        }
        let success;
        if (best.kind === 'upgrade') {
          best.item.buy(1);
          success = Boolean(best.item.bought);
        } else success = buyBuilding(g, best.item, best.count);
        if (!success) { status = `等待商店更新：${name}`; break; }
        log(`購買 ${best.kind === 'bundle' ? `${name} ×${best.count}` : label}`);
        status = `已購買 ${name}`;
        if (g.recalculateGains) g.CalculateGains();
        if (best.kind === 'bundle') break; // Let the game's own logic unlock the upgrade.
      }
    }

    const guard = fn => {
      let errors = 0;
      return () => {
        try { fn(); errors = 0; }
        catch (error) {
          status = error.message;
          log(`錯誤：${error.message}`);
          errors++;
          if (errors >= 3) {
            config.enabled = false;
            write('config', config);
            status = `已暫停：${error.message}`;
          }
          env.onError?.(error);
        }
      };
    };
    return {
      fastTick: guard(fastTick), slowTick: guard(slowTick),
      get config() { return { ...config }; },
      get pending() { return pending ? { ...pending } : null; },
      get logs() { return logs.slice(); },
      get state() { return { status, lastAction, plan: lastPlan, ascension: ascendInfo(g, config, now()), clickRate: clickRate() }; },
      setConfig(changes) {
        config = sanitize({ ...config, ...changes });
        clickStart = now(); clickTimes = []; nextClick = 0;
        write('config', config);
        return { ...config };
      },
      backup,
      getBackups: () => read('backups', []),
      plan: () => plan(g, config, clickRate()),
    };
  }

  function mountPanel(win, engine) {
    const doc = win.document;
    const host = doc.createElement('div');
    host.id = 'cookie-optimizer-panel';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host{position:fixed;left:12px;bottom:12px;z-index:1000000;color-scheme:dark;font:13px/1.5 system-ui,"Microsoft JhengHei",sans-serif;color:#f4ede4;text-align:left}
        *{box-sizing:border-box}section{width:350px;max-width:calc(100vw - 24px);max-height:80vh;overflow:auto;background:#201a16f5;border:1px solid #8d6e4e;border-radius:12px;box-shadow:0 8px 36px #0009}
        header{display:flex;align-items:center;gap:8px;padding:11px 13px;background:#3a2b20;position:sticky;top:0;z-index:1}
        strong{flex:1;font-size:14px}button,select,input{font:inherit}button{cursor:pointer;border:1px solid #98724b;border-radius:6px;background:#59402a;color:#fff;padding:4px 9px}button:hover{background:#795631}
        main{padding:12px}p{margin:0 0 8px;overflow-wrap:anywhere}small{color:#cbbbaa}label{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:8px 0}input[type=number]{width:85px}input,select{color:#fff;background:#32251c;border:1px solid #806348;border-radius:4px;padding:3px}input[type=checkbox]{accent-color:#e2b665}
        details{border-top:1px solid #5e4735;margin-top:10px;padding-top:9px}summary{cursor:pointer;color:#ebc785}h4{margin:10px 0 5px;color:#ebc785}table{width:100%;border-collapse:collapse;font-size:11px}td,th{padding:5px 3px;border-bottom:1px solid #4c392a;text-align:right}td:first-child,th:first-child{text-align:left;max-width:156px;overflow-wrap:anywhere}
        .actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.muted{color:#b9ac9d}.pill{font-size:11px;color:#e9c686}.collapsed main{display:none}.collapsed{width:auto}ol{padding-left:20px;max-height:140px;overflow:auto;font-size:11px}
      </style>
      <section><header><strong>🍪 自然成長助手</strong><span class="pill">v${VERSION}</span><button id="collapse" aria-label="收合控制面板">−</button></header><main>
        <p id="status" role="status"></p><p id="metrics" class="muted"></p><p id="ascension" class="muted"></p><p id="action"><small></small></p>
        <div class="actions"><button id="toggle"></button><button id="backup">匯出目前存檔</button><button id="download">下載重生前備份</button></div>
        <details open><summary>自動化設定</summary><div id="settings"></div></details>
        <details><summary>策略與重生門檻</summary><div id="strategy"></div><small>自動重生會重置本輪進度。先備份，再收割皺皮蟲、出售建築、購買巧克力蛋，並依天界樹前置條件購買升級後重生。</small></details>
        <details><summary>候選投資</summary><small>評分 = 等待秒數 + 價格 ÷ 增量每秒收益。＊表示含策略估值。</small><table><thead><tr><th>項目</th><th>Δ收益/秒</th><th>評分</th></tr></thead><tbody id="candidates"></tbody></table></details>
        <details><summary>操作紀錄</summary><ol id="logs"></ol></details>
      </main></section>`;
    doc.documentElement.appendChild(host);
    const $ = id => shadow.getElementById(id);
    const addControl = (container, key, label, options) => {
      const row = doc.createElement('label');
      const text = doc.createElement('span'); text.textContent = label; row.appendChild(text);
      const input = doc.createElement(options ? 'select' : 'input');
      const value = engine.config[key];
      if (options) {
        for (const [v, title] of options) { const option = doc.createElement('option'); option.value = v; option.textContent = title; input.appendChild(option); }
        input.value = value;
      } else if (typeof value === 'boolean') { input.type = 'checkbox'; input.checked = value; }
      else { input.type = 'number'; input.value = value; input.step = key === 'prestigeGainRatio' ? '0.1' : '1'; input.min = key === 'reserveSeconds' || key === 'ascendCountdownSeconds' ? '0' : key === 'prestigeGainRatio' ? '0.1' : '1'; }
      input.dataset.setting = key;
      input.addEventListener('change', () => {
        const next = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
        const config = engine.setConfig({ [key]: next });
        if (input.type === 'number') input.value = config[key];
        render();
      });
      row.appendChild(input); $(container).appendChild(row);
    };
    for (const [key, label] of [
      ['autoClick', '自動點大餅'], ['clicksPerSecond', '每秒點擊次數'], ['autoBuy', '購買建築與升級'],
      ['collectGolden', '收集金餅'], ['collectWrath', '收集憤怒餅（有風險）'],
      ['collectReindeer', '收集馴鹿'], ['autoSpell', '加成期間施放命運之手'],
      ['harvestLumps', '收成已熟糖塊'], ['autoResearch', '購買研究升級'],
      ['autoSanta', '升級聖誕老人'], ['autoDragon', '訓練龍並選擇產量光環'],
      ['autoAscend', '自動升天與重生'],
    ]) addControl('settings', key, label);
    addControl('strategy', 'reserveMode', '金餅存款策略', [['smart', '智慧保留'], ['always', '優先保留'], ['off', '不保留']]);
    addControl('strategy', 'grandmapocalypse', '祖母末日研究', [['oneMind', '停在 One mind'], ['off', '不觸發'], ['full', '完整研究']]);
    for (const [key, label] of [
      ['reserveSeconds', '額外保留幾秒產量'], ['maxWaitSeconds', '候選最長等待秒數'],
      ['firstAscendChips', '首次重生碎片目標'], ['prestigeGainRatio', '之後新增聲望／目前聲望'],
      ['minRunMinutes', '每輪至少幾分鐘'], ['ascendCountdownSeconds', '重生倒數秒數'],
      ['sellBeforeAscend', '升天前出售本輪建築'], ['autoHeavenly', '自動購買天界升級'],
      ['autoPermanentSlots', '自動安排永久升級欄位'],
    ]) addControl('strategy', key, label);
    const download = entry => {
      const blob = new win.Blob([entry.save], { type: 'text/plain;charset=utf-8' });
      const url = win.URL.createObjectURL(blob);
      const a = doc.createElement('a'); a.href = url;
      a.download = `cookie-clicker-${entry.reason}-${new Date(entry.createdAt).toISOString().replace(/[:.]/g, '-')}.txt`;
      doc.body.appendChild(a); a.click(); a.remove();
      win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
    };
    $('toggle').onclick = () => { engine.setConfig({ enabled: !engine.config.enabled }); render(); };
    $('collapse').onclick = () => { engine.setConfig({ collapsed: !engine.config.collapsed }); render(); };
    $('backup').onclick = () => {
      try { download(engine.backup()); } catch (error) { $('status').textContent = error.message; }
    };
    $('download').onclick = () => {
      const entry = engine.getBackups().find(b => b.reason === 'before-ascend');
      if (entry) download(entry); else $('status').textContent = '尚無重生前備份，可先匯出目前存檔。';
    };
    function render() {
      const config = engine.config;
      const state = engine.state;
      shadow.querySelector('section').classList.toggle('collapsed', config.collapsed);
      $('collapse').textContent = config.collapsed ? '+' : '−';
      $('toggle').textContent = config.enabled ? '暫停' : '繼續';
      $('status').textContent = config.enabled ? state.status : '已暫停';
      $('metrics').textContent = `有效點擊 ${format(state.clickRate)}/秒 · 本金 ${format(win.Game.cookies)}`;
      $('ascension').textContent = `${config.autoAscend ? '自動重生' : '重生關閉'}：新增 ${format(state.ascension.gain)} / ${format(state.ascension.target)} 碎片${state.ascension.projectedGain > state.ascension.gain ? `（收成後約 ${format(state.ascension.projectedGain)}）` : ''}${state.ascension.reason ? ` · ${state.ascension.reason}` : ''}`;
      for (const input of shadow.querySelectorAll('[data-setting]')) {
        if (shadow.activeElement === input) continue;
        const value = config[input.dataset.setting];
        if (input.type === 'checkbox') input.checked = value;
        else input.value = value;
      }
      $('action').firstElementChild.textContent = state.lastAction || '依目前遊戲狀態計算投資';
      $('candidates').replaceChildren();
      for (const candidate of state.plan?.candidates.slice(0, 5) || []) {
        const row = doc.createElement('tr');
        const label = `${candidate.item.dname || candidate.item.name}${candidate.kind === 'bundle' ? ` ×${candidate.count} + 升級` : ''}`;
        for (const value of [label, `${candidate.estimated ? '＊' : ''}${format(Math.max(0, candidate.delta))}`, duration(candidate.score)]) {
          const cell = doc.createElement('td'); cell.textContent = value; row.appendChild(cell);
        }
        $('candidates').appendChild(row);
      }
      $('logs').replaceChildren();
      for (const entry of engine.logs.slice(0, 15)) {
        const li = doc.createElement('li'); li.textContent = `${new Date(entry.time).toLocaleTimeString('zh-TW')} ${entry.message}`; $('logs').appendChild(li);
      }
    }
    render();
    return { render, remove: () => host.remove() };
  }

  function install(win) {
    if (win.CookieOptimizer?.destroy) win.CookieOptimizer.destroy();
    let stopped = false;
    let engine;
    let panel;
    let fastTimer;
    let slowTimer;
    let waitTimer;
    const controller = {
      version: VERSION,
      get engine() { return engine; },
      pause: () => controller.configure({ enabled: false }),
      resume: () => controller.configure({ enabled: true }),
      configure(changes) {
        const config = engine?.setConfig(changes);
        panel?.render();
        return config;
      },
      getStatus: () => engine?.state,
      backup: () => engine?.backup(),
      destroy() {
        stopped = true;
        for (const timer of [fastTimer, slowTimer, waitTimer]) if (timer) win.clearInterval(timer);
        panel?.remove();
        if (win.CookieOptimizer === controller) delete win.CookieOptimizer;
      },
    };
    win.CookieOptimizer = controller;
    const ready = () => {
      if (stopped || !win.Game?.ready || !win.Game.CalculateGains || !win.Game.HowMuchPrestige) return;
      win.clearInterval(waitTimer);
      let storage;
      try { storage = win.localStorage; } catch { /* Acquiring storage can itself throw. */ }
      engine = createEngine(win.Game, {
        storage, prefix: `cookie-optimizer:v1:${win.Game.SaveTo || win.location.pathname}`,
        onError: error => win.console.error('[CookieOptimizer]', error),
      });
      panel = mountPanel(win, engine);
      fastTimer = win.setInterval(() => engine.fastTick(), 25);
      slowTimer = win.setInterval(() => { engine.slowTick(); panel.render(); }, 1000);
      win.console.info(`[CookieOptimizer ${VERSION}] 已啟動；CookieOptimizer.pause() 可暫停。`);
    };
    waitTimer = win.setInterval(ready, 500);
    ready();
    return controller;
  }

  return { VERSION, DEFAULTS, HEAVENLY_PRIORITY, sanitize, probe, buildingPrice, buyBuilding,
    allowedUpgrade, reserveFor, plan, wrinklerPayout, ascendInfo, heavenlyAvailable, heavenlyPath,
    buyHeavenly, assignPermanent, createEngine, install };
});
