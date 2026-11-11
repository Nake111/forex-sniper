(() => {
  const main = document.querySelector("main");
  if (!main) return;

  const section = document.createElement("section");
  section.className = "panel";
  section.style.cssText = "margin-top:4px";
  const heading = document.createElement("div");
  heading.className = "row";
  const intro = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = "Independent market cross-check · Investing.com";
  title.style.marginBottom = "4px";
  const note = document.createElement("div");
  note.className = "muted";
  note.textContent = "Secondary human verification only. Quotes may be delayed or use a different provider than the engine.";
  intro.append(title, note);
  const badge = document.createElement("span");
  badge.className = "pill";
  badge.textContent = "MANUAL CHECK";
  heading.append(intro, badge);

  const markets = [
    ["EUR/USD", "https://www.investing.com/currencies/eur-usd", "Forex quote / chart"],
    ["BTC/USD", "https://www.investing.com/crypto/bitcoin", "Bitcoin reference"],
    ["Gold (XAU/USD)", "https://www.investing.com/commodities/gold", "Gold reference"]
  ];
  const list = document.createElement("div");
  list.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:14px";
  for (const [name, url, description] of markets) {
    const card = document.createElement("div");
    card.style.cssText = "background:#0a1220;border:1px solid #1c2a40;border-radius:9px;padding:12px";
    const label = document.createElement("b");
    label.textContent = name;
    const sub = document.createElement("div");
    sub.className = "muted";
    sub.style.cssText = "font-size:11px;margin:3px 0 9px";
    sub.textContent = description;
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "btn";
    link.style.cssText = "display:inline-block;text-decoration:none";
    link.textContent = "Open Investing.com ↗";
    card.append(label, sub, link);
    list.append(card);
  }

  const warning = document.createElement("div");
  warning.className = "muted";
  warning.style.cssText = "font-size:11px;margin-top:12px;border-top:1px solid #1b283a;padding-top:10px";
  warning.textContent = "Do not copy these displayed prices into the automated signal engine. Compare instrument, timestamp, quote type and session. A mismatch is a data-quality warning for a human reviewer; it does not create or cancel a BUY/SELL by itself. Investing.com does not provide a public API, so this panel does not scrape or ingest its pages.";
  section.append(heading, list, warning);
  const footer = main.querySelector(".foot");
  main.insertBefore(section, footer || null);
})();
