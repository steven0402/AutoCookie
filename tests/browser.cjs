'use strict';
// Optional live integration test. Uses a NEW temporary Chrome profile, never a user save.
// Requires Node 22+ and Chrome. Artificial test cookies exist only in that profile.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const http = require('node:http');
const { fixture } = require('./fixture.cjs');
const { installOfficial } = require('./official.cjs');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await check(); if (result) return result; await delay(250); }
  throw Error(`Timed out after ${timeout}ms`);
}

async function main() {
  let server;
  let url = 'https://orteil.dashnet.org/cookieclicker/';
  const live = process.argv.includes('--live');
  if (!live) {
    const sourceIndex = process.argv.indexOf('--source');
    const officialSource = sourceIndex >= 0 ? await fs.readFile(process.argv[sourceIndex + 1], 'utf8') : null;
    const bootstrap = `
      const f=(${fixture.toString()})(); window.Game=f.g;
      f.building('Cursor',0,15,0.1); f.building('Grandma',0,100,1);
      f.upgrade('Kitten helpers',9000,{kitten:1}); f.upgrade('Plastic mouse',1000);
      f.upgrade('Legacy',1,{pool:'prestige'});
      f.upgrade('Permanent upgrade slot I',100,{pool:'prestige',activateFunction:()=>{Game.promptOn=1}});
      Game.Has=name=>Game.Upgrades[name]?.bought?1:0;
      Game.Earn=amount=>{Game.cookies+=amount;Game.cookiesEarned+=amount};
      Game.killShimmers=()=>{Game.shimmers=[]};
      ${officialSource ? `(${installOfficial.toString()})(Game,${JSON.stringify(officialSource).replace(/</g, '\\u003c')});` : ''}
      Game.Ascend=()=>{Game.AscendTimer=1;setTimeout(()=>{const p=Math.floor(Game.HowMuchPrestige(Game.cookiesReset+Game.cookiesEarned));Game.heavenlyChips+=p-Game.prestige;Game.prestige=p;Game.AscendTimer=0;Game.OnAscend=1},100)};
      Game.Reincarnate=()=>{Game.OnAscend=0;Game.startDate=Date.now();Game.ReincarnateTimer=1;Game.resets=1;setTimeout(()=>{Game.ReincarnateTimer=0},100)};
      Game.CalculateGains();
    `;
    server = http.createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><meta charset="utf-8"><title>Cookie Optimizer integration fixture</title><style>body{background:#2d2119;color:#e9d7ba;font:18px system-ui;padding:50px}</style><h1>Cookie Optimizer</h1><p>Isolated integration fixture${officialSource ? ' + official calculation functions' : ''}</p><script>${bootstrap}</script>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/`;
  }
  const profile = path.resolve(os.tmpdir(), `cookie-optimizer-browser-${randomUUID()}`);
  const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-port=0',
    '--window-size=1440,1000', `--user-data-dir=${profile}`, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let socket;
  let send;
  try {
    let stderr = '';
    const endpoint = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error(`Chrome startup timed out: ${stderr.slice(-1000)}`)), 15000);
      chrome.once('error', error => { clearTimeout(timeout); reject(error); });
      chrome.stderr.on('data', chunk => {
        stderr += chunk;
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let id = 0;
    const requests = new Map();
    const exceptions = [];
    socket.addEventListener('message', event => {
      const data = JSON.parse(event.data);
      if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails.text);
      if (data.id && requests.has(data.id)) {
        const pending = requests.get(data.id); requests.delete(data.id); clearTimeout(pending.timer);
        if (data.error) pending.reject(Error(data.error.message)); else pending.resolve(data.result);
      }
    });
    send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { requests.delete(requestId); reject(Error(`CDP timeout: ${method}`)); }, 30000);
      requests.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const target = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const page = (method, params) => send(method, params, sessionId);
    const evaluate = async expression => {
      const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    await page('Runtime.enable');
    await page('Page.enable');
    await page('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('CookieClickerLang','EN');" });
    await page('Page.navigate', { url });
    try { await until(() => evaluate('Boolean(window.Game && Game.ready)'), 60000); }
    catch (error) {
      console.error(await evaluate('({title:document.title,text:document.body.innerText.slice(0,1800)})'));
      throw error;
    }
    const source = await fs.readFile(path.resolve(__dirname, '../cookie-optimizer.user.js'), 'utf8');
    await evaluate(source);
    await until(() => evaluate('Boolean(window.CookieOptimizer && CookieOptimizer.engine)'));
    if (!live) assert.equal(await evaluate('Array.isArray(Game.ObjectsById[0].tieredUpgrades)'), false, 'browser fixture uses official object-keyed tiers');
    // This seeded bakery is temporary. The userscript itself never grants currency.
    await evaluate(`CookieOptimizer.configure({autoAscend:false,autoDragon:false,autoSanta:false,reserveMode:'off'}); Game.Earn(1e12);`);
    await delay(2500);
    const purchase = await evaluate(`({buildings:Game.BuildingsOwned,upgrades:Game.UpgradesOwned,clicks:Game.cookieClicks,logs:CookieOptimizer.engine.logs,status:CookieOptimizer.getStatus().status,version:Game.version,panel:!!document.getElementById('cookie-optimizer-panel')})`);
    assert.ok(purchase.buildings > 0, 'real buildings purchased');
    assert.ok(purchase.clicks > 0, 'real cookie clicks');
    assert.ok(purchase.panel, 'panel mounted');
    assert.ok(!purchase.logs.some(log => log.message.startsWith('錯誤')), 'no engine error');
    console.log('Browser purchasing:', JSON.stringify(purchase));
    const settingWorks = await evaluate(`(() => {
      const input=document.getElementById('cookie-optimizer-panel').shadowRoot.querySelector('[data-setting="collectWrath"]');
      input.checked=false;input.dispatchEvent(new Event('change'));
      return CookieOptimizer.engine.config.collectWrath===false;
    })()`);
    assert.ok(settingWorks, 'panel change updates engine configuration');

    // Verify probes are read-only against the full shipped CalculateGains function.
    const probe = await evaluate(`(() => {
      CookieOptimizer.pause();
      const snapshot = () => JSON.stringify({cookies:Game.cookies,earned:Game.cookiesEarned,achievements:(Game.AchievementsById||[]).map(a=>a.won),upgrades:Game.UpgradesById.map(u=>u.bought),buildings:Game.ObjectsById.map(b=>[b.amount,b.bought,b.highest,b.storedCps,b.storedTotalCps]),cps:Game.cookiesPs,raw:Game.cookiesPsRawHighest,byType:Game.cookiesPsByType,mults:Game.cookiesMultByType});
      const before=snapshot(); const p=CookieOptimizer.engine.plan();
      return {unchanged:before===snapshot(),candidates:p.candidates.length,delta:p.best?.delta};
    })()`);
    assert.ok(probe.unchanged, 'full game state is unchanged by hypothetical planning');
    console.log('Browser probe rollback:', JSON.stringify(probe));
    const clicks = await evaluate('Game.cookieClicks');
    await delay(300); assert.equal(await evaluate('Game.cookieClicks'), clicks, 'pause stops clicks');

    await evaluate(`(() => {
      Game.killShimmers(); Game.buffs={}; Game.recalculateGains=1; Game.CalculateGains();
      Game.cookiesEarned=Math.pow(500,3)*1e12; Game.cookies=Game.cookiesEarned;
      Game.startDate=Date.now()-3600000;
      CookieOptimizer.configure({enabled:true,autoClick:false,autoAscend:true,firstAscendChips:440,minRunMinutes:1,ascendCountdownSeconds:0});
      CookieOptimizer.engine.slowTick(); CookieOptimizer.engine.slowTick();
    })()`);
    await until(() => evaluate('Game.resets>=1 && !Game.OnAscend && !Game.AscendTimer && !Game.ReincarnateTimer'), 45000);
    await evaluate('CookieOptimizer.pause()');
    assert.equal(await evaluate("document.getElementById('cookie-optimizer-panel').shadowRoot.getElementById('toggle').textContent"), '繼續');
    const ascension = await evaluate(`({resets:Game.resets,prestige:Game.prestige,legacy:Game.Has('Legacy'),heavenly:Game.PrestigeUpgrades.filter(u=>u.bought).map(u=>u.name),permanent:Game.permanentUpgrades,prompt:Game.promptOn,backups:CookieOptimizer.engine.getBackups().length,logs:CookieOptimizer.engine.logs})`);
    assert.equal(ascension.resets, 1); assert.ok(ascension.prestige >= 440);
    assert.equal(ascension.legacy, 1); assert.equal(ascension.prompt, 0); assert.equal(ascension.backups, 1);
    assert.ok(!ascension.logs.some(log => log.message.startsWith('錯誤')));
    console.log('Browser ascension:', JSON.stringify(ascension));
    assert.deepEqual(exceptions, [], 'no uncaught browser exceptions');
    const artifactDir = path.resolve(__dirname, '../.artifacts');
    await fs.mkdir(artifactDir, { recursive: true });
    const png = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.writeFile(path.join(artifactDir, 'optimizer-panel.png'), Buffer.from(png.data, 'base64'));
    console.log('Browser integration passed. Page exceptions:', JSON.stringify(exceptions));
  } finally {
    if (send && socket?.readyState === 1) await send('Browser.close').catch(() => {});
    socket?.close();
    chrome.kill();
    if (server) await new Promise(resolve => server.close(resolve));
    // Verify the absolute target is our own temporary profile before recursive deletion.
    if (path.dirname(profile) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith('cookie-optimizer-browser-')) throw Error('Unexpected temporary profile path');
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }).catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
