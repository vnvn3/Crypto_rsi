// ===============================
// Ultra-Pro Scalping Engine — Cloudflare Compatible
// ===============================

export async function runBot(env, BOT_TOKEN, CHAT_ID) {

  // ===============================
  // تنظیمات قابل تغییر
  // ===============================
  const SETTINGS = {
    TIMEFRAME: "15m",
    LIMIT_PAIRS: 35,
    LIMIT_KLINES: 120,
    MIN_VOLUME: 40000,
    VWAP_THRESHOLD: 0.0025,
    ATR_SPIKE_MULTIPLIER: 2.2,
    SCORE_THRESHOLD: 6,     // سیگنال قوی
    SCORE_STRONG: 8,        // ورود مطمئن
    SCORE_GOLD: 10          // ورود طلایی
  };

  // ===============================
  // توابع کمکی
  // ===============================

  function avg(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  async function getPairs(limit) {
    const url = "https://www.okx.com/api/v5/market/tickers?instType=SPOT";
    const res = await fetch(url);
    const data = await res.json();
    return data.data
      .filter(p => p.instId.endsWith("USDT"))
      .slice(0, limit)
      .map(p => p.instId);
  }

  async function getKlines(pair) {
    const url = `https://www.okx.com/api/v5/market/candles?instId=${pair}&bar=${SETTINGS.TIMEFRAME}&limit=${SETTINGS.LIMIT_KLINES}`;
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

  // ===============================
  // سیگنال‌ها
  // ===============================

  function detectDivergence(closes, volumes) {
    const rsi = calcRSI(closes);

    if (closes.at(-1) < closes.at(-3) &&
        rsi.at(-1) > rsi.at(-3) &&
        rsi.at(-1) < 35 &&
        volumes.at(-1) > avg(volumes.slice(-20))) {
      return { name: "دایورجنس مثبت", score: 3 };
    }

    if (closes.at(-1) > closes.at(-3) &&
        rsi.at(-1) < rsi.at(-3) &&
        rsi.at(-1) > 65 &&
        volumes.at(-1) > avg(volumes.slice(-20))) {
      return { name: "🟢دایورجنس منفی", score: 3 };
    }

    return null;
  }

  function detectBOS(highs, lows, closes) {
    const i = closes.length - 3;

    if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1] &&
        closes.at(-1) > highs[i]) {
      return { name: "🟢.BOS صعودی", score: 2 };
    }

    if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1] &&
        closes.at(-1) < lows[i]) {
      return { name: "🔴.BOS نزولی", score: 2 };
    }

    return null;
  }

  function detectCHoCH(highs, lows, closes) {
    const trendUp = closes.at(-1) > closes.at(-5);
    const trendDown = closes.at(-1) < closes.at(-5);
    const i = closes.length - 3;

    if (trendDown && closes.at(-1) > highs[i]) {
      return { name: "🟢.CHoCH صعودی", score: 2 };
    }

    if (trendUp && closes.at(-1) < lows[i]) {
      return { name: "🔴.CHoCH نزولی", score: 2 };
    }

    return null;
  }

  function detectVWAP(closes, volumes) {
    let sumPV = 0, sumV = 0;
    for (let i = 0; i < closes.length; i++) {
      sumPV += closes[i] * volumes[i];
      sumV += volumes[i];
    }
    const vwap = sumPV / sumV;
    const last = closes.at(-1);

    if (Math.abs(last - vwap) / vwap < SETTINGS.VWAP_THRESHOLD) {
      return { name: `نزدیک .VWAP (${vwap.toFixed(4)})`, score: 1 };
    }

    return null;
  }

  function detectSpike(highs, lows, closes, opens, volumes, atr) {
    const body = Math.abs(closes.at(-1) - opens.at(-1));
    const vol = volumes.at(-1);

    if (body > atr * SETTINGS.ATR_SPIKE_MULTIPLIER &&
        vol > avg(volumes.slice(-20)) * 2) {
      return { name: "اسپایک حجم", score: 2 };
    }

    return null;
  }

  // ===============================
  // ارسال پیام تلگرام
  // ===============================
  async function sendTelegram(msg) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: msg })
    });
  }

  // ===============================
  // اجرای اصلی
  // ===============================

  const pairs = await getPairs(SETTINGS.LIMIT_PAIRS);
  let finalMessages = [];

  for (const pair of pairs) {
    try {
      const data = await getKlines(pair);
      const { closes, volumes, highs, lows, opens } = data;

      if (avg(volumes.slice(-10)) < SETTINGS.MIN_VOLUME) continue;

      const atr = calcATR(highs, lows, closes);

      let signals = [];
      let score = 0;

      const s1 = detectDivergence(closes, volumes);
      if (s1) { signals.push(s1.name); score += s1.score; }

      const s2 = detectBOS(highs, lows, closes);
      if (s2) { signals.push(s2.name); score += s2.score; }

      const s3 = detectCHoCH(highs, lows, closes);
      if (s3) { signals.push(s3.name); score += s3.score; }

      const s4 = detectVWAP(closes, volumes);
      if (s4) { signals.push(s4.name); score += s4.score; }

      const s5 = detectSpike(highs, lows, closes, opens, volumes, atr);
      if (s5) { signals.push(s5.name); score += s5.score; }

      if (score >= SETTINGS.SCORE_THRESHOLD) {
        let strength = "سیگنال قوی";
        if (score >= SETTINGS.SCORE_STRONG) strength = "ورود مطمئن";
        if (score >= SETTINGS.SCORE_GOLD) strength = "ورود طلایی";

        finalMessages.push(
          `${pair}\nامتیاز: ${score}\nقدرت: ${strength}\n${signals.join("\n")}`
        );
      }

    } catch (e) {
      continue;
    }
  }

  if (finalMessages.length > 0) {
    await sendTelegram(finalMessages.join("\n\n"));
  }
}
