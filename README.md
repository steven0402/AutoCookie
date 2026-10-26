# Cookie Clicker 自然成長助手

這是一支瀏覽器 userscript，自動操作 [Cookie Clicker 官方網頁版](https://orteil.dashnet.org/cookieclicker/)，附繁體中文控制面板。使用正常遊戲的點擊、購買、施法、祭獻和升天成本，不增加餅乾、不解鎖未達成條件的升級，也不預測或重抽亂數。

**預設會自動升天與重生。** 首次目標為 440 天界碎片；之後的新增聲望達到目前聲望的 100% 時，於本輪至少 15 分鐘、收益加成結束後開始 10 秒倒數。面板可暫停、關閉自動重生或調整門檻。

## 安裝

1. 在瀏覽器安裝 [Tampermonkey](https://www.tampermonkey.net/)。
2. 在 Tampermonkey 建立新腳本，刪除預設內容，貼入 [cookie-optimizer.user.js](./cookie-optimizer.user.js) 的完整內容並儲存。
3. 開啟或重新整理官方遊戲，等待載入完成。左下角會出現「自然成長助手」。

不需要 Node.js、npm、伺服器或建置。若只想試一次，也可在遊戲頁的開發者工具 Console 貼上整份 JS；這種方式重新整理後需再貼一次。

適用官方現代網頁版與 beta 路徑；不適用 Classic、手機原生版或其他網站的仿製遊戲。未在每個 beta 版本逐一驗證。

## 更新與錯誤排除

`v1.0.1` 修正 `Object is not iterable`：官方的建築階級升級資料 `tieredUpgrades` 是以階級為鍵的物件，現在會正確讀取物件中的升級資料，測試資料也已同步改成官方結構。

已安裝 Tampermonkey 時，可開啟 [安裝／更新腳本](https://github.com/steven0402/AutoCookie/raw/refs/heads/main/cookie-optimizer.user.js)，依提示更新；也可將最新版完整內容貼回原腳本並儲存。重新整理遊戲後，面板版本應顯示 `v1.0.1`。舊版若曾因連續錯誤自動暫停，請按「繼續」；不需清除存檔或網站資料。

## 會做什麼

| 功能 | 行為 |
| --- | --- |
| 購買建築、一般升級、研究 | 比較每個候選項目的價格、增加的穩定每秒收益及等待時間；買完即重新計算 |
| 點擊升級 | 將自動點擊帶來的收益一起計算；預設 20 次／秒，上限 40 |
| 建築門檻 | 將附近的建築數量門檻與後續階級升級合併試算，預設最多前看 25 棟 |
| 金餅、憤怒餅、馴鹿、幸運新聞 | 自動收集；憤怒餅可在面板獨立關閉 |
| 金餅存款 | 智慧模式對快速回本投資優先再投資；有 Get lucky 且回本超過 10 分鐘時保留 Frenzy + Lucky 存款 |
| 魔法書 | 魔力接近全滿、有產量加成且尚無點擊加成時施放命運之手；保留正常施法費用和失敗機率 |
| 糖塊 | 在已熟、尚未過熟時收成，不花糖塊 |
| 聖誕老人 | 已擁有 A festive hat 時，於成本可負擔且低於約 2 分鐘收入時升級 |
| 龍 | 訓練已解鎖的龍；祭獻前預留補回建築的資金，並按穩定收益比較已解鎖的產量光環 |
| 祖母末日 | 預設研究停在 One mind；可改成不觸發或完整研究 |
| 皺皮蟲 | 平時保留；滿群且可支應一筆需等待至少 5 分鐘的投資時收割一隻普通皺皮蟲。升天前包含閃亮皺皮蟲在內全部收割 |
| 升天、天界升級、重生 | 先備份，再收成、出售本輪建築、購買已解鎖的 Chocolate egg、升天，依前置條件購買天界升級並重生 |
| 永久欄位 | 優先保留較高階小貓、Get lucky、游標階級與金餅升級；可關閉自動安排 |

會尊重遊戲的 Vault，不購買 debug 升級、不花糖塊購買升級，也不任意操作開關類商品。手動升天時由你操作；腳本只接管自己發起的重生程序。Born again 挑戰模式中暫停自動操作。

龍、聖誕老人和一般升級都由「購買建築與升級」總開關控制。自動收集、施法及重生則各有獨立設定。

## 收益策略

候選項目的基本評分為：

```text
等待時間 + 價格 / 增量每秒收益
```

分數越低越優先。等待時間使用目前可入帳的收入；長期收益則包含餵食中皺皮蟲將來收成的收益。收益試算排除暫時的 Frenzy、Click frenzy 等加成，避免把短暫爆發當成永久收入。金餅頻率、解鎖聖誕老人等無立即 CpS 效果的升級使用策略估值，候選清單會標示「＊」。

建築門檻組合會計入建築及升級的完整成本，但實際先購買建築，等遊戲自行解鎖升級後再重新評估。保留金餅存款時，等待時間也會計入需要補足的存款。

首次 440 碎片是實用的起點，不是數學上唯一的最佳答案。後續預設等新增聲望達到目前聲望，相當於聲望約翻倍後重生；門檻設為 `0.5` 代表新增 50% 即可考慮重生，設為 `2` 代表新增 200%。皺皮蟲尚未入帳的收益也會納入升天時機判斷，實際等收成完成才升天。

這是實用的收益啟發式策略，**不保證全局最大收益**。沒有自動配置花園、萬神殿、股票市場、季節輪替、糖塊升級或 Godzamok 買賣連段；不刻意卡帶有 7 的聲望數字來解鎖幸運天界升級，而是在其條件符合時購買。魔法書等小遊戲需已在遊戲內解鎖。

背景分頁可能受到瀏覽器計時器節流，實際點擊速度會降低；腳本會依觀測速度修正估算，不在回到前景時補點一大串。

## 備份與控制

每次自動升天前，會以遊戲的 `Game.WriteSave(1)` 建立可匯入的完整存檔，將備份與待執行狀態先寫入該網站的 `localStorage`。保留最近三份備份；儲存失敗就停止進入重生的破壞性步驟。

按「下載重生前備份」下載；要回復時，先暫停腳本，再將備份文字貼入遊戲選項的「匯入存檔」。按「匯出目前存檔」可另存目前進度。清除網站資料會一起移除設定與瀏覽器內備份，下載的文字檔則可另外保存。

Console 也可控制：

```js
CookieOptimizer.pause();
CookieOptimizer.resume();
CookieOptimizer.configure({ autoAscend: false });
CookieOptimizer.configure({ firstAscendChips: 440, prestigeGainRatio: 1 });
CookieOptimizer.getStatus();
CookieOptimizer.destroy(); // 移除本次執行的面板與計時器
```

設定會保存在該網站與遊戲存檔槽對應的 `localStorage`。`destroy()` 不會停用 Tampermonkey 中已安裝的腳本；若要永久停用，從擴充功能停用這支腳本。

## 驗證與開發

執行時沒有第三方套件。基本測試需 Node.js 18 以上：

```powershell
npm test
npm run check
```

涵蓋正常購買、出售模式還原、試算回滾、成就副作用防護、點擊收益、建築門檻、金餅存款、Vault、研究限制、皺皮蟲收益、備份失敗、升天、天界樹前置條件及重生續接。

另有使用官方收益函式的測試，以及在**獨立暫存 Chrome 設定檔**執行的本機瀏覽器整合測試。後者需 Node.js 22 以上及 Chrome，可用 `CHROME_PATH` 指定執行檔：

```powershell
$sourcePath = Join-Path $env:TEMP 'cookie-clicker-main.js'
Invoke-WebRequest 'https://orteil.dashnet.org/cookieclicker/main.js' -OutFile $sourcePath
npm run test:official -- $sourcePath
npm run test:browser -- --source $sourcePath
```

整合測試使用模擬存檔及官方的 `CalculateGains`、`mouseCps` 和 `ComputeCps` 函式，測試購買、試算後狀態不變、暫停、面板及重生流程。測試用餅乾只存在於該隔離環境。也提供 `npm run test:browser -- --live` 嘗試直接測試官網；本次官網被 Cloudflare 安全驗證擋住，**尚未完成實際官網全流程測試**。

官方遊戲更新及第三方模組可能改變 API。試算時會暫停執行第三方收益 hooks，避免它們對假設購買產生副作用，因此不保證與其他自動化或改變收益的模組相容。

## 機制來源

- [Cookie Clicker 官方程式 main.js](https://orteil.dashnet.org/cookieclicker/main.js)：收益、建築價格、升天、天界升級、永久欄位與皺皮蟲計算。
- [官方魔法書程式](https://orteil.dashnet.org/cookieclicker/minigameGrimoire.js)：法術成本及失敗機率。
- [Tampermonkey 官方網站](https://www.tampermonkey.net/)：userscript 安裝與管理。

本次核對與測試日期：2026-10-26。
