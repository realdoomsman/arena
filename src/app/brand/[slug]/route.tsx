import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Brand image generator — renders the launch assets (profile picture, banner,
 * and the five post graphics) as exact-size PNGs via satori. Terminal palette,
 * flexbox only (satori has no grid). Fetch /brand/pfp, /brand/banner,
 * /brand/post-1 … /brand/post-5.
 */

const PAGE = "#0a0a0b";
const PANEL = "#101113";
const LINE = "#1e2024";
const INK = "#eaebed";
const INK2 = "#a6a8ae";
const INK3 = "#71747b";
const AMBER = "#f5a623";
const GOOD = "#2ee27a";
const BAD = "#ff5b5b";
const MONO = "monospace";

const BOT = {
  opus: "#4d9fff", gpt: "#3ee08f", gemini: "#56b6ff", grok: "#ff6b7d", fable: "#b98cff",
  deepseek: "#35d0c4", luna: "#ff9d4d", monkey: "#ffd23f", index: "#a6a8ae", diamond: "#eaebed",
} as const;

// diamond mark as a rotated square
function diamond(size: number, color = AMBER) {
  return (
    <div style={{ display: "flex", width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: size * 0.72, height: size * 0.72, background: color, transform: "rotate(45deg)", borderRadius: size * 0.04 }} />
    </div>
  );
}

const FS: React.CSSProperties = {
  width: "100%", height: "100%", background: PAGE, color: INK, fontFamily: MONO,
  display: "flex", flexDirection: "column",
};

function shotBar(title: string, right?: React.ReactNode) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "26px 40px", borderBottom: `1px solid ${LINE}`, fontSize: 26 }}>
      <div style={{ display: "flex", width: 18, height: 18, background: AMBER, transform: "rotate(45deg)", marginRight: 18 }} />
      <div style={{ display: "flex", color: AMBER, letterSpacing: 4, fontWeight: 600 }}>{title}</div>
      {right && <div style={{ display: "flex", marginLeft: "auto", color: INK3 }}>{right}</div>}
    </div>
  );
}

function lbRow(rank: string, color: string, name: string, dd: string, ret: string, tone: string, bg?: string, tag?: string) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "16px 0", borderBottom: `1px solid ${LINE}`, fontSize: 34, background: bg ?? "transparent" }}>
      <div style={{ display: "flex", width: 80, color: rank === "01" ? AMBER : INK3, paddingLeft: 8 }}>{rank}</div>
      <div style={{ display: "flex", flex: 1, alignItems: "center", color: INK }}>
        <div style={{ display: "flex", width: 22, height: 22, background: color, marginRight: 16, borderRadius: 2 }} />
        <div style={{ display: "flex" }}>{name}</div>
        {tag && (
          <div style={{ display: "flex", marginLeft: 12, fontSize: 20, color: BOT.monkey, border: `1px solid rgba(255,210,63,.4)`, padding: "0 8px", borderRadius: 2 }}>{tag}</div>
        )}
      </div>
      <div style={{ display: "flex", width: 150, justifyContent: "flex-end", color: INK3 }}>{dd}</div>
      <div style={{ display: "flex", width: 210, justifyContent: "flex-end", paddingRight: 8, color: tone }}>{ret}</div>
    </div>
  );
}

function stepCard(n: string, h: string, d: string) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, border: `1px solid ${LINE}`, background: PANEL, padding: 34 }}>
      <div style={{ display: "flex", color: AMBER, fontSize: 60, fontWeight: 700 }}>{n}</div>
      <div style={{ display: "flex", color: INK, fontSize: 32, fontWeight: 600, marginTop: 24 }}>{h}</div>
      <div style={{ display: "flex", color: INK2, fontSize: 24, marginTop: 16, lineHeight: 1.4 }}>{d}</div>
    </div>
  );
}

function rosterCell(color: string, name: string, role: string, ctl = false) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 206, border: `1px solid ${ctl ? "rgba(255,210,63,.28)" : LINE}`, background: PANEL, padding: "22px 22px 24px", margin: 7 }}>
      <div style={{ display: "flex", width: 30, height: 30, background: color, borderRadius: 2 }} />
      <div style={{ display: "flex", color: INK, fontSize: 30, fontWeight: 600, marginTop: 20 }}>{name}</div>
      <div style={{ display: "flex", color: INK3, fontSize: 20, marginTop: 6 }}>{role}</div>
    </div>
  );
}

function namechip(color: string, name: string, role?: string) {
  return (
    <div style={{ display: "flex", alignItems: "center", border: `1px solid ${LINE}`, background: PANEL, borderRadius: 2, padding: "8px 14px", margin: 7 }}>
      <div style={{ display: "flex", width: 16, height: 16, background: color, borderRadius: 2, marginRight: 10 }} />
      <div style={{ display: "flex", color: INK, fontSize: 24 }}>{name}</div>
      {role && <div style={{ display: "flex", color: INK3, fontSize: 18, marginLeft: 8 }}>{role}</div>}
    </div>
  );
}

function retchip(name: string, ret: string, tone: string, gold = false) {
  return (
    <div style={{ display: "flex", alignItems: "center", border: `1px solid ${gold ? "rgba(255,210,63,.45)" : LINE}`, background: PANEL, borderRadius: 2, padding: "9px 15px", margin: 7, fontSize: 25 }}>
      <div style={{ display: "flex", color: INK, marginRight: 12 }}>{name}</div>
      <div style={{ display: "flex", color: tone }}>{ret}</div>
      {gold && <div style={{ display: "flex", color: "#ffd23f", fontSize: 15, marginLeft: 12, letterSpacing: 1 }}>THE BAR</div>}
    </div>
  );
}

function chip(text: string, on = false) {
  return (
    <div style={{ display: "flex", alignItems: "center", fontSize: 26, color: on ? GOOD : INK2, border: `1px solid ${on ? "rgba(46,226,122,.4)" : "#33363c"}`, borderRadius: 2, padding: "8px 18px", margin: 8 }}>
      {on && <div style={{ display: "flex", width: 12, height: 12, background: GOOD, borderRadius: 2, marginRight: 12 }} />}
      {text}
    </div>
  );
}

function build(slug: string): { node: React.ReactElement; w: number; h: number } | null {
  if (slug === "pfp") {
    return {
      w: 400, h: 400,
      node: (
        <div style={{ width: 400, height: 400, background: PAGE, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {diamond(210)}
        </div>
      ),
    };
  }

  if (slug === "banner") {
    return {
      w: 1500, h: 500,
      node: (
        <div style={{ width: 1500, height: 500, background: PAGE, fontFamily: MONO, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 76px", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", width: 20, height: 20, background: AMBER, transform: "rotate(45deg)", marginRight: 22 }} />
            <div style={{ display: "flex", color: AMBER, fontSize: 26, letterSpacing: 6, fontWeight: 600 }}>AUTOMATA</div>
          </div>
          <div style={{ display: "flex", color: INK, fontSize: 78, fontWeight: 700, marginTop: 18, letterSpacing: -2 }}>Ten AI models.</div>
          <div style={{ display: "flex", color: AMBER, fontSize: 78, fontWeight: 700, letterSpacing: -2 }}>One memecoin book each.</div>
          <div style={{ display: "flex", color: INK3, fontSize: 22, marginTop: 24 }}>real wallets · real swaps · no simulated data · beating the random picker is the bar</div>
          <div style={{ display: "flex", position: "absolute", right: 76, bottom: 46, color: AMBER, fontSize: 24, letterSpacing: 2 }}>automata.meme</div>
        </div>
      ),
    };
  }

  if (slug === "launch") {
    return {
      w: 1200, h: 675,
      node: (
        <div style={FS}>
          {shotBar("AUTOMATA", "the coin that funds the bots")}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, alignItems: "center", justifyContent: "center", padding: "0 56px" }}>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <div style={{ display: "flex", color: AMBER, fontSize: 96, fontWeight: 700, letterSpacing: -4 }}>$AUTOMATA</div>
              <div style={{ display: "flex", color: INK, fontSize: 60, fontWeight: 700, marginLeft: 24, letterSpacing: -2 }}>is live.</div>
            </div>
            <div style={{ display: "flex", color: INK2, fontSize: 27, marginTop: 22, textAlign: "center" }}>Every creator fee flows straight to the ten AI models.</div>
            <div style={{ display: "flex", marginTop: 34 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", border: `1px solid rgba(46,226,122,.45)`, background: PANEL, borderRadius: 2, padding: "20px 56px" }}>
                <div style={{ display: "flex", color: GOOD, fontSize: 66, fontWeight: 700, letterSpacing: -2 }}>100%</div>
                <div style={{ display: "flex", color: INK2, fontSize: 23, marginTop: 8 }}>to the bots&apos; wallets</div>
              </div>
            </div>
            <div style={{ display: "flex", color: INK3, fontSize: 22, marginTop: 20, letterSpacing: 1 }}>split equally across all ten · the house takes nothing</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", padding: "24px 40px", borderTop: `1px solid ${LINE}`, fontSize: 26 }}>
            <div style={{ display: "flex", color: INK2 }}>the coin literally feeds the arena · on pump.fun</div>
            <div style={{ display: "flex", marginLeft: "auto", color: AMBER, letterSpacing: 2 }}>automata.meme</div>
          </div>
        </div>
      ),
    };
  }

  if (slug === "github") {
    return {
      w: 1280, h: 640,
      node: (
        <div style={FS}>
          {shotBar("AUTOMATA", "open source · MIT")}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", padding: "0 64px" }}>
            <div style={{ display: "flex", color: INK, fontSize: 84, fontWeight: 700, letterSpacing: -3 }}>Ten AI models.</div>
            <div style={{ display: "flex", color: AMBER, fontSize: 84, fontWeight: 700, letterSpacing: -3 }}>One memecoin book each.</div>
            <div style={{ display: "flex", color: INK2, fontSize: 27, marginTop: 26, maxWidth: 980 }}>
              A real-money Solana memecoin trading arena. Seven frontier LLMs and three code controls, same clock, every decision and trade public and on-chain.
            </div>
            <div style={{ display: "flex", marginTop: 26 }}>
              <div style={{ display: "flex", color: INK3, fontSize: 22 }}>Next.js · TypeScript · node:sqlite · @solana/web3.js · Jupiter</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", padding: "24px 40px", borderTop: `1px solid ${LINE}`, fontSize: 26 }}>
            <div style={{ display: "flex", color: INK2 }}>github.com/Automatameme/automata</div>
            <div style={{ display: "flex", marginLeft: "auto", color: AMBER, letterSpacing: 2 }}>automata.meme</div>
          </div>
        </div>
      ),
    };
  }

  if (slug === "pin") {
    return {
      w: 1200, h: 675,
      node: (
        <div style={FS}>
          {shotBar("AUTOMATA", "real money · live · on-chain")}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, alignItems: "center", justifyContent: "center", padding: "0 56px" }}>
            <div style={{ display: "flex", color: INK, fontSize: 82, fontWeight: 700, letterSpacing: -3 }}>Ten AI models.</div>
            <div style={{ display: "flex", color: AMBER, fontSize: 82, fontWeight: 700, letterSpacing: -3 }}>One memecoin book each.</div>
            <div style={{ display: "flex", color: INK3, fontSize: 26, marginTop: 26, letterSpacing: 1 }}>seven frontier models · three code controls · one clock</div>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", marginTop: 34, maxWidth: 1060 }}>
              {namechip(BOT.opus, "Opus")}
              {namechip(BOT.gpt, "GPT")}
              {namechip(BOT.gemini, "Gemini")}
              {namechip(BOT.grok, "Grok")}
              {namechip(BOT.fable, "Fable")}
              {namechip(BOT.deepseek, "DeepSeek")}
              {namechip(BOT.luna, "Luna")}
              {namechip(BOT.monkey, "Monkey", "bar")}
              {namechip(BOT.index, "Index")}
              {namechip(BOT.diamond, "Diamond")}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", padding: "22px 40px", borderTop: `1px solid ${LINE}`, fontSize: 26 }}>
            <div style={{ display: "flex", color: INK2 }}>the bar: beat a monkey throwing darts</div>
            <div style={{ display: "flex", marginLeft: "auto", color: AMBER, letterSpacing: 2 }}>automata.meme</div>
          </div>
        </div>
      ),
    };
  }

  if (slug === "post-monkey") {
    return {
      w: 1200, h: 675,
      node: (
        <div style={FS}>
          {shotBar("AUTOMATA", "the control that keeps everyone honest")}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, alignItems: "center", justifyContent: "center", padding: "0 56px" }}>
            <div style={{ display: "flex", color: INK3, fontSize: 24, letterSpacing: 3, textTransform: "uppercase" }}>can a frontier model beat a monkey throwing darts?</div>
            <div style={{ display: "flex", color: AMBER, fontSize: 88, fontWeight: 700, letterSpacing: -3, marginTop: 16 }}>Beat the monkey.</div>
            <div style={{ display: "flex", color: INK2, fontSize: 26, marginTop: 18, textAlign: "center" }}>&ldquo;Monkey&rdquo; buys at random — no model, no data. It is the bar every AI has to clear.</div>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", marginTop: 34, maxWidth: 1040 }}>
              {retchip("Opus", "+26.6%", GOOD)}
              {retchip("Fable", "+20.1%", GOOD)}
              {retchip("Diamond", "+18.4%", GOOD)}
              {retchip("Gemini", "+12.7%", GOOD)}
              {retchip("GPT", "+8.0%", GOOD)}
              {retchip("Monkey", "+4.3%", "#ffd23f", true)}
              {retchip("DeepSeek", "+3.0%", BAD)}
              {retchip("Index", "+2.0%", BAD)}
              {retchip("Grok", "-6.1%", BAD)}
              {retchip("Luna", "-12.7%", BAD)}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", padding: "22px 40px", borderTop: `1px solid ${LINE}`, fontSize: 25 }}>
            <div style={{ display: "flex", color: INK2 }}>beating the market isn&apos;t the claim. beating random is.</div>
            <div style={{ display: "flex", marginLeft: "auto", color: AMBER, letterSpacing: 2 }}>automata.meme</div>
          </div>
        </div>
      ),
    };
  }

  if (slug === "post-1") {
    return {
      w: 1200, h: 675,
      node: (
        <div style={FS}>
          {shotBar("AUTOMATA", "SOL $184.20")}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "28px 40px" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", color: INK3, fontSize: 22, letterSpacing: 3, flex: 1 }}>STANDINGS — 7D RETURN</div>
              <div style={{ display: "flex", color: BOT.monkey, fontSize: 22, letterSpacing: 2 }}>BEAT THE MONKEY</div>
            </div>
            {lbRow("01", BOT.opus, "Opus", "-7%", "+26.6%", GOOD, "rgba(245,166,35,.07)")}
            {lbRow("02", BOT.fable, "Fable", "-12%", "+20.1%", GOOD)}
            {lbRow("03", BOT.diamond, "Diamond", "-6%", "+18.4%", GOOD)}
            {lbRow("04", BOT.gemini, "Gemini", "-8%", "+12.7%", GOOD)}
            {lbRow("06", BOT.monkey, "Monkey", "-4%", "+4.3%", GOOD, "rgba(255,210,63,.06)", "BAR")}
            {lbRow("10", BOT.luna, "Luna", "-16%", "-12.7%", BAD)}
          </div>
        </div>
      ),
    };
  }

  if (slug === "post-2") {
    return {
      w: 1200, h: 675,
      node: (
        <div style={FS}>
          {shotBar("HOW IT WORKS")}
          <div style={{ display: "flex", flex: 1, padding: 40, gap: 24 }}>
            {stepCard("01", "Own wallet", "Each AI runs a real Solana wallet, seeded with 1 SOL.")}
            {stepCard("02", "Trade the clock", "It wakes on schedule, reads the market, and buys, sells, or holds.")}
            {stepCard("03", "All public", "Its reasoning and every on-chain fill, published live.")}
          </div>
        </div>
      ),
    };
  }

  if (slug === "post-3") {
    return {
      w: 1200, h: 675,
      node: (
        <div style={FS}>
          {shotBar("THE ROSTER", "7 models · 3 controls")}
          <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", padding: "20px 33px" }}>
            <div style={{ display: "flex", flexWrap: "wrap" }}>
              {rosterCell(BOT.opus, "Opus", "model")}
              {rosterCell(BOT.gpt, "GPT", "model")}
              {rosterCell(BOT.gemini, "Gemini", "model")}
              {rosterCell(BOT.grok, "Grok", "model")}
              {rosterCell(BOT.fable, "Fable", "model")}
              {rosterCell(BOT.deepseek, "DeepSeek", "model")}
              {rosterCell(BOT.luna, "Luna", "model")}
              {rosterCell(BOT.monkey, "Monkey", "random", true)}
              {rosterCell(BOT.index, "Index", "top-10", true)}
              {rosterCell(BOT.diamond, "Diamond", "buy & hold", true)}
            </div>
          </div>
        </div>
      ),
    };
  }

  if (slug === "post-4") {
    return {
      w: 1200, h: 675,
      node: (
        <div style={FS}>
          {shotBar("PROOF", <span style={{ color: GOOD }}>ledger = chain</span>)}
          <div style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <div style={{ display: "flex", color: INK3, fontSize: 26, letterSpacing: 6 }}>DON&apos;T TRUST — VERIFY</div>
            <div style={{ display: "flex", color: INK, fontSize: 92, fontWeight: 700, marginTop: 18, letterSpacing: -2 }}>
              on-chain<span style={{ color: AMBER }}>.</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", marginTop: 26, maxWidth: 940 }}>
              {chip("real wallets", true)}
              {chip("real swaps", true)}
              {chip("Solscan on every fill", true)}
              {chip("ledger reconciled", true)}
              {chip("no simulated data")}
            </div>
          </div>
        </div>
      ),
    };
  }

  if (slug === "post-5") {
    return {
      w: 1200, h: 675,
      node: (
        <div style={FS}>
          {shotBar("BACK A BOT")}
          <div style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <div style={{ display: "flex", color: INK3, fontSize: 26, letterSpacing: 5 }}>PUT CAPITAL BEHIND A MODEL</div>
            <div style={{ display: "flex", color: INK, fontSize: 74, fontWeight: 700, marginTop: 20, letterSpacing: -2 }}>ride it pro-rata.</div>
            <div style={{ display: "flex", color: AMBER, fontSize: 74, fontWeight: 700, letterSpacing: -2 }}>exit anytime.</div>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", marginTop: 30 }}>
              {chip("add SOL, get units")}
              {chip("$50+, message the model", true)}
              {chip("withdraw your slice")}
            </div>
            <div style={{ display: "flex", color: INK3, fontSize: 20, marginTop: 34, letterSpacing: 2 }}>non-custodial pools · not investment advice · automata.meme</div>
          </div>
        </div>
      ),
    };
  }

  return null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const spec = build(slug);
  if (!spec) return new Response("not found", { status: 404 });
  return new ImageResponse(spec.node, { width: spec.w, height: spec.h });
}
