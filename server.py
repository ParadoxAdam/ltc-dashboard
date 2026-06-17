"""
LTC Adaptive Dashboard - Local Server with Live Data
=====================================================
Run: python server.py
Then open: http://localhost:5000

API endpoints:
  GET  /              -> Dashboard UI
  GET  /api/prices    -> Live LTC and BTC prices (Binance, fallback CoinGecko)
  GET  /api/weekly    -> Last 300 weekly bars for LTC and BTC
  GET  /api/state     -> Saved state (JSON)
  POST /api/state     -> Save state (JSON body)
"""

from flask import Flask, jsonify, request, render_template
import json
import requests
import threading
import time
import webbrowser
from pathlib import Path
from datetime import datetime, timezone

app = Flask(__name__)

# Persistent storage location
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
STATE_FILE = DATA_DIR / "state.json"

# Simple in-memory cache for weekly data (refreshed every 6 hours)
_weekly_cache = {"data": None, "fetched_at": 0}
_WEEKLY_TTL_SECS = 6 * 3600

DEFAULT_STATE = {
    "tracker": {
        "ltc": 53.61,
        "startEq": 5000,
        "projDays": 365,
        "daysOverride": "",
        "tranches": {},
        "exits": {},
        "cfg": {
            "swapRate": 25, "perLotPerDollar": 75, "marginPerLot": 90,
            "spreadLot": 8, "commLot": 0, "fxRate": 1.33
        }
    },
    "exitComparison": {
        "structLow": 45.11, "rangeHigh": 59,
        "autoAdapt": "yes",
        "peakPrice": 475,
        "bDays": 240, "bLots": 25, "bPrice": 130,
        "peakLots": 50, "avgEntry": 140, "latePace": 20,
        "swapRate": 25, "fxRate": 1.33, "spread": 8, "startEq": 5000
    },
    "dashboard": {
        "manualCapitulation": "auto",
        "manualSentiment": "dead"
    }
}


def load_state():
    if STATE_FILE.exists():
        try:
            saved = json.loads(STATE_FILE.read_text())
            # Merge with defaults to handle new fields
            merged = json.loads(json.dumps(DEFAULT_STATE))  # deep copy
            for key in merged:
                if key in saved:
                    if isinstance(merged[key], dict):
                        merged[key].update(saved[key])
                    else:
                        merged[key] = saved[key]
            return merged
        except Exception as e:
            print(f"[warn] State load failed: {e}, using defaults")
    return json.loads(json.dumps(DEFAULT_STATE))


def save_state_to_disk(state):
    try:
        STATE_FILE.write_text(json.dumps(state, indent=2))
    except Exception as e:
        print(f"[error] State save failed: {e}")


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/prices')
def api_prices():
    """Fetch current LTC and BTC. Binance primary, CoinGecko fallback."""
    # Try Binance
    try:
        ltc_r = requests.get(
            'https://api.binance.com/api/v3/ticker/24hr?symbol=LTCUSDT',
            timeout=5
        )
        btc_r = requests.get(
            'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT',
            timeout=5
        )
        if ltc_r.ok and btc_r.ok:
            ltc = ltc_r.json()
            btc = btc_r.json()
            return jsonify({
                'ltc': float(ltc['lastPrice']),
                'ltc24h': float(ltc['priceChangePercent']),
                'ltcHigh24h': float(ltc['highPrice']),
                'ltcLow24h': float(ltc['lowPrice']),
                'ltcVolume24h': float(ltc['quoteVolume']),
                'btc': float(btc['lastPrice']),
                'btc24h': float(btc['priceChangePercent']),
                'btcHigh24h': float(btc['highPrice']),
                'btcLow24h': float(btc['lowPrice']),
                'source': 'Binance',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
    except Exception as e:
        print(f"[warn] Binance failed: {e}")

    # Fallback: CoinGecko
    try:
        r = requests.get(
            'https://api.coingecko.com/api/v3/simple/price'
            '?ids=litecoin,bitcoin&vs_currencies=usd'
            '&include_24hr_change=true&include_24hr_vol=true',
            timeout=5
        )
        if r.ok:
            d = r.json()
            return jsonify({
                'ltc': d['litecoin']['usd'],
                'ltc24h': d['litecoin'].get('usd_24h_change', 0),
                'ltcVolume24h': d['litecoin'].get('usd_24h_vol', 0),
                'btc': d['bitcoin']['usd'],
                'btc24h': d['bitcoin'].get('usd_24h_change', 0),
                'btcVolume24h': d['bitcoin'].get('usd_24h_vol', 0),
                'source': 'CoinGecko',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
    except Exception as e:
        print(f"[error] CoinGecko also failed: {e}")

    return jsonify({'error': 'All price APIs unavailable'}), 503


@app.route('/api/weekly')
def api_weekly():
    """Fetch weekly OHLC. Cached for 6 hours."""
    now = time.time()
    if _weekly_cache["data"] and (now - _weekly_cache["fetched_at"]) < _WEEKLY_TTL_SECS:
        return jsonify(_weekly_cache["data"])

    try:
        ltc_r = requests.get(
            'https://api.binance.com/api/v3/klines?symbol=LTCUSDT&interval=1w&limit=300',
            timeout=10
        )
        btc_r = requests.get(
            'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=300',
            timeout=10
        )
        if not (ltc_r.ok and btc_r.ok):
            raise Exception(f"Binance status: LTC={ltc_r.status_code}, BTC={btc_r.status_code}")

        def parse(klines):
            return [{
                't': int(k[0]),
                'o': float(k[1]),
                'h': float(k[2]),
                'l': float(k[3]),
                'c': float(k[4]),
                'v': float(k[5])
            } for k in klines]

        data = {
            'ltc': parse(ltc_r.json()),
            'btc': parse(btc_r.json()),
            'source': 'Binance',
            'fetched_at': datetime.now(timezone.utc).isoformat()
        }
        _weekly_cache["data"] = data
        _weekly_cache["fetched_at"] = now
        return jsonify(data)
    except Exception as e:
        if _weekly_cache["data"]:
            print(f"[warn] Weekly fetch failed ({e}), serving stale cache")
            return jsonify(_weekly_cache["data"])
        return jsonify({'error': str(e)}), 503


@app.route('/api/state', methods=['GET', 'POST'])
def api_state():
    if request.method == 'POST':
        try:
            state = request.get_json()
            save_state_to_disk(state)
            return jsonify({'ok': True})
        except Exception as e:
            return jsonify({'error': str(e)}), 400
    return jsonify(load_state())


@app.route('/api/health')
def health():
    return jsonify({
        'status': 'ok',
        'time': datetime.now(timezone.utc).isoformat()
    })


def open_browser_delayed():
    """Open browser after a short delay so server is ready."""
    time.sleep(1.5)
    try:
        webbrowser.open('http://localhost:5000')
    except Exception:
        pass


if __name__ == '__main__':
    print("\n" + "=" * 60)
    print("  LTC Adaptive Dashboard")
    print("=" * 60)
    print(f"  Server:  http://localhost:5000")
    print(f"  Data:    {DATA_DIR.absolute()}")
    print(f"  Stop:    Ctrl+C")
    print("=" * 60 + "\n")

    threading.Thread(target=open_browser_delayed, daemon=True).start()
    app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)
