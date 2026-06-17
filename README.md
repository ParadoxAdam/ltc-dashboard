# LTC Adaptive Dashboard

Local Python web app that runs the LTC pyramid dashboard, tracker, and exit-comparison tools with live data from public crypto APIs (Binance primary, CoinGecko fallback). Runs entirely on your machine — no cloud dependencies, your state stays local.

## Quick start

1. **Install Python 3.10 or newer** if you don't have it. Get it from https://python.org. During install, tick **"Add Python to PATH"**.

2. **Unzip this folder** somewhere convenient, e.g. `C:\projects\ltc-dashboard\`.

3. **Right-click** `start.ps1` → **Run with PowerShell**.
   - First run will install Flask and requests (one-time).
   - Server starts at `http://localhost:5000`.
   - Browser opens automatically.

That's it. Click "Allow" if Windows Defender asks about the Python network listener.

## What you get

Three tabs at the top:

- **Dashboard** — adaptive weekly check-in with live LTC/BTC, auto-computed structural levels, 6-condition checklist, strategy recommendation, and action card. Use this once a week.
- **50-Lot Tracker** — log fills, watch live equity with all costs (swap, spread, margin, liquidation). Auto-fills entry price with current live price when you click "fill". Same calculation logic as the artifact tracker but the price is now real.
- **Exit Comparison** — four exit strategies side-by-side, with auto-adapted defaults based on live price and structural levels. Slide the "peak price" to test outcomes.

Prices auto-refresh every 30 seconds. Weekly OHLC refreshes every 6 hours (cached for efficiency).

## State persistence

Everything you log — filled tranches, exit fills, settings, dashboard manual inputs — saves to `data/state.json` automatically (debounced 500ms after each change). To reset, delete that file and refresh the browser.

## Customization

### Change the auto-refresh interval

Edit `static/app.js`, find `setInterval(() => window.refreshPrices(true), 30000);` and change `30000` (milliseconds) to whatever you want. 60000 = 60 seconds, etc.

### Use a different price source

Edit `server.py` → `api_prices()`. The current order is Binance → CoinGecko fallback. You can swap in CoinMarketCap, Kraken, your broker's API, or anything else that returns JSON.

### Connect to your MT5 broker

You'd add a Python MetaTrader5 dependency (`pip install MetaTrader5`) and an MT5 fetch path in `server.py`. The script imports `MetaTrader5 as mt5`, calls `mt5.initialize(...)` with your credentials, and `mt5.symbol_info_tick("LTCUSD")` returns bid/ask. You can wire it as a third option in `api_prices()` so MT5 is tried first when available, otherwise falls back to public APIs.

### Change tranche structure, exit strategies, or trigger logic

Edit the relevant JS file in `static/`:
- `dashboard.js` — trigger zones, conditions, strategy logic
- `tracker.js` — tranches, exits, cost calculations
- `exit-comparison.js` — strategies, auto-adapt logic

All three share `app.js` for live data and state management.

## File structure

```
ltc-dashboard/
├── server.py                  Flask backend
├── start.ps1                  PowerShell launcher
├── requirements.txt           Python deps (flask, requests)
├── README.md                  This file
├── templates/
│   └── index.html            Single-page UI with tabs
├── static/
│   ├── styles.css            Design tokens, layout
│   ├── app.js                Shared state, live data fetching
│   ├── dashboard.js          Dashboard widget
│   ├── tracker.js            Tracker widget
│   └── exit-comparison.js    Exit comparison widget
└── data/
    └── state.json            Persistent state (auto-created)
```

## Troubleshooting

**Server starts but the page won't load.** Check that nothing else is using port 5000. To change the port, edit the last line of `server.py`: `app.run(host='127.0.0.1', port=5000, ...)`.

**"Failed to fetch" errors.** Check your internet connection. Binance and CoinGecko both need to be reachable. If you're on a network that blocks them, you can swap in any other JSON price API by editing `server.py`.

**The browser shows old data.** Hard-refresh with `Ctrl+F5`. State is read from disk on first load, then kept in memory until you save changes.

**Want to run it on another machine.** It's a regular Flask app — copy the folder and run `start.ps1`. Each machine has its own `data/state.json`.

**Want to expose it to your phone on the same network.** Edit `server.py`'s last line: change `host='127.0.0.1'` to `host='0.0.0.0'`. Then on your phone, open `http://YOUR_PC_IP:5000`. (Find your IP with `ipconfig`.) Only do this on a trusted network — this is a local dev server, not hardened for the open internet.

## What's not in this version

- Authentication (anyone on your machine can see the dashboard — fine for local single-user use)
- Multiple portfolios (only one set of tracker state at a time)
- Trade execution (this is decision support; you place actual trades in your broker)
- Historical chart visualization (the widgets show structural levels but don't render candle charts; ask me in chat to add this if you want it)
- MT5 direct integration (see Customization section above for how to add it)

## License

Use it however you want. No warranty — verify the math before betting real money on it.
