// ===============================
// bot.js — نسخه مخصوص Cloudflare + GitHub
// ===============================

// توابع کمکی
function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// گرفتن کندل‌ها از OKX
async function getKlines(pair, TIMEFRAME, LIMIT_KLINES) {
  const url = `https://www.okx.com/api/v5/market/candles?instId=${pair}&bar=${TIMEFRAME}&limit=${LIMIT_KLINES}`;
  const res = await fetch(url);
  const data = await res.json();
  const rows = data.data.reverse();

  return {
    closes: rows.map(r => parseFloat(r[4])),
    volumes: rows.map(r => parseFloat(r[5])),
    highs: rows.map(r => parseFloat(r[2])),
    lows: rows.map(r => parseFloat(r[3])),
    opens: rows.map(r => parseFloat(r[1]))
  };
}

// گرفتن لیست جفت‌ارزها
async function getPairs(LIMIT_PAIRS) {
  const url = "https://www.okx.com/api/v5/market/tickers?instType=SPOT";
  const res = await fetch(url);
  const data = await res.json();

  return data.data
    .filter(p => p.instId.endsWith("USDT"))
    .slice(0, LIMIT_PAIRS)
    .map(p => p.instId);
}

// ATR
function calcATR(highs, lows, closes) {
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }
  return avg(trs.slice(-14));
}

// RSI
function calcRSI(closes) {
  const period = 14;
  if (closes.length <= period) return Array(closes.length).fill(50);

  const deltas = closes.slice(1).map((c, i) => c - closes[i]);
  let up = 0, down = 0;

  for (let i = 0; i < period; i++) {
    if (deltas[i] >= 0) up += deltas[i];
    else down -= deltas[i];
  }

  up /= period;
  down /= period;

  const rsi = Array(closes.length).fill(50);

  for (let i = period; i < closes.length; i++) {
    const delta = deltas[i - 1];
    up = (up * (period - 1) + Math.max(delta, 0)) / period;
    down = (down * (period - 1) + Math.max(-delta, 0)) / period;
    const rs = up / (down || 1);
    rsi[i] = 100 - 100 / (1 + rs);
  }

  return rsi;
}

// دایورجنس
function detectDivergence(closes, volumes) {
  const rsi = calcRSI(closes);

  if (closes.at(-1) < closes.at(-3) &&
      rsi.at(-1) > rsi.at(-3) &&
      rsi.at(-1) < 35 &&
      volumes.at(-1) > avg(volumes.slice(-20)) &&
      closes.at(-1) > closes.at(-2)) {
    return "دایورجنس مثبت تازه";
  }

  if (closes.at(-1) > closes.at(-3) &&
      rsi.at(-1) < rsi.at(-3) &&
      rsi.at(-1) > 65 &&
      volumes.at(-1) > avg(volumes.slice(-20)) &&
      closes.at(-1) < closes.at(-2)) {
    return "دایورجنس منفی تازه";
  }

  return null;
}

// BOS
function detectBOS(highs, lows, closes) {
  const i = closes.length - 3;

  if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1]) {
    if (closes.at(-1) > highs[i]) return "BOS صعودی";
  }

  if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1]) {
    if (closes.at(-1) < lows[i]) return "BOS نزولی";
  }

  return null;
}

// CHoCH
function detectCHoCH(highs, lows, closes) {
  const trendUp = closes.at(-1) > closes.at(-5);
  const trendDown = closes.at(-1) < closes.at(-5);
  const i = closes.length - 3;

  if (trendDown && closes.at(-1) > highs[i]) return "CHoCH صعودی";
  if (trendUp && closes.at(-1) < lows[i]) return "CHoCH نزولی";

  return null;
}

// اسپایک
function detectSpike(highs, lows, closes, opens, volumes, atr) {
  const body = Math.abs(closes.at(-1) - opens.at(-1));
  const vol = volumes.at(-1);

  if (body > atr * 2 && vol > avg(volumes.slice(-20)) * 2) {
    return "اسپایک قوی";
  }

  return null;
}

// VWAP
function calcVWAP(closes, volumes) {
  let sumPV = 0, sumV = 0;
  for (let i = 0; i < closes.length; i++) {
    sumPV += closes[i] * volumes[i];
    sumV += volumes[i];
  }
  return sumPV / sumV;
}

// ارسال پیام تلگرام
async function sendTelegram(BOT_TOKEN, CHAT_ID, msg) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg })
  });
}

// ===============================
// تابع اصلی که Cloudflare Worker اجرا می‌کند
// ===============================

export default async function runBot(env, BOT_TOKEN, CHAT_ID) {

  const TIMEFRAME = "15m";
  const LIMIT_PAIRS = 35;
  const LIMIT_KLINES = 80;
  const MIN_VOLUME = 50000;
  const VWAP_THRESHOLD = 0.002;

  const pairs = await getPairs(LIMIT_PAIRS);
  let finalMessages = [];

  for (const pair of pairs) {
    try {
      const data = await getKlines(pair, TIMEFRAME, LIMIT_KLINES);
      const { closes, volumes, highs, lows, opens } = data;

      if (avg(volumes.slice(-10)) < MIN_VOLUME) continue;

      const atr = calcATR(highs, lows, closes);
      const lastPrice = closes.at(-1);

      let signals = [];

      const div = detectDivergence(closes, volumes);
      if (div) signals.push(div);

      const vwap = calcVWAP(closes, volumes);
      if (Math.abs(lastPrice - vwap) / vwap < VWAP_THRESHOLD) {
        signals.push(`قیمت نزدیک VWAP (${vwap.toFixed(4)})`);
      }

      const bos = detectBOS(highs, lows, closes);
      if (bos) signals.push(bos);

      const choch = detectCHoCH(highs, lows, closes);
      if (choch) signals.push(choch);

      const spike = detectSpike(highs, lows, closes, opens, volumes, atr);
      if (spike) signals.push(spike);

      if (signals.length > 0) {
        finalMessages.push(`${pair}\n${signals.join("\n")}`);
      }

    } catch (e) {
      continue;
    }
  }

  if (finalMessages.length > 0) {
    await sendTelegram(BOT_TOKEN, CHAT_ID, finalMessages.join("\n\n"));
  }
}
