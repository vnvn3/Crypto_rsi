import requests
import numpy as np
import talib
import os

def get_klines(symbol="BTCUSDT", interval="15m", limit=200):
    url = f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}"
    data = requests.get(url).json()
    closes = np.array([float(c[4]) for c in data])
    return closes

def find_divergence_rsi(closes):
    rsi = talib.RSI(closes, timeperiod=14)

    price_low1 = closes[-5]
    price_low2 = closes[-1]

    rsi_low1 = rsi[-5]
    rsi_low2 = rsi[-1]

    if price_low2 < price_low1 and rsi_low2 > rsi_low1:
        return "دایورجنس مثبت"

    if price_low2 > price_low1 and rsi_low2 < rsi_low1:
        return "دایورجنس منفی"

    return None

def send_telegram(msg):
    token = os.getenv("BOT_TOKEN")
    chat_id = os.getenv("CHAT_ID")
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    requests.post(url, data={"chat_id": chat_id, "text": msg})

def main():
    closes = get_klines("BTCUSDT")
    div = find_divergence_rsi(closes)
    if div:
        send_telegram(f"BTCUSDT → {div}")

if __name__ == "__main__":
    main()
