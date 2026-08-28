// Backing a bot, and leaving one.
//
// Capital is POOLED: buying in mints pro-rata units in the bot's wallet at the
// live unit price, and leaving burns them at the live unit price. Nobody gets
// a better price for arriving earlier, and a deposit at fair value neither
// dilutes the holders already there nor discounts the new one.
//
// ── THE RULE THAT PROTECTS WHOEVER STAYS ────────────────────────────────────
// A leaver is paid their share of the IDLE SOL plus the ACTUAL PROCEEDS of
// selling their share of every position. Not their share of NAV.
//
// The difference is the entire fairness question. NAV is computed at mid
// price; a real sale into a thin memecoin pool comes back less. Paying a
// leaver full NAV out of the cash pile would quietly hand them the difference
// and take it from the people who did not leave. So we sell their slice, watch
// what it actually fetches, and pay them that.
import { getDb } from "./db";
import { withBotLock } from "./bot-lock";
import {
  getBot,
  getBotNav,
  recordFlow,
  totalUnits,
  getUserUnits,
  unitsForDeposit,
  type BotRow,
} from "./bot-nav";
import { executeSell } from "./bot-engine";
import { getAccountWallet, getSolBalance, signSendConfirmOneWith, LAMPORTS_PER_SOL, WITHDRAW_RESERVE_LAMPORTS } from "./accounts";
import { buildSolTransfer } from "./swap";
import { invalidateWallet } from "./wallets";

export class InvestError extends Error {}

/** Smallest meaningful stake. Below this, fees dominate the position. */
export const MIN_INVEST_LAMPORTS = 20_000_000; // 0.02 SOL

// The per-bot capital lock now lives in bot-lock.ts so the wake engine shares
// the exact same lock — a bot's wake, an invest and a withdraw all serialize.

export type InvestResult = {
  botSlug: string;
  lamports: number;
  units: number;
  unitPrice: number;
  signature: string;
};

/**
 * Put SOL behind a bot.
 *
 * The transfer is confirmed before any units are minted. Minting first would
 * mean a failed transfer left somebody owning a share of a wallet they never
 * funded, diluting everyone else.
 */
export async function investInBot(
  userId: number,
  slug: string,
  lamports: number
): Promise<InvestResult> {
  if (!Number.isFinite(lamports) || lamports < MIN_INVEST_LAMPORTS) {
    throw new InvestError(
      `Minimum stake is ${(MIN_INVEST_LAMPORTS / LAMPORTS_PER_SOL).toFixed(3)} SOL`
    );
  }

  const bot = getBot(slug);
  if (!bot) throw new InvestError("No such bot");
  if (!bot.enabled) throw new InvestError(`${bot.name} is not accepting capital`);

  return withBotLock(bot.id, async () => {
  const wallet = getAccountWallet(userId);
  if (!wallet) throw new InvestError("Your account has no wallet yet");

  const balance = await getSolBalance(wallet.address); // lamports
  if (balance < lamports + WITHDRAW_RESERVE_LAMPORTS) {
    throw new InvestError(
      `Not enough SOL — you have ${(balance / LAMPORTS_PER_SOL).toFixed(4)}, and some must stay behind for network fees`
    );
  }

  // Price the entry against NAV BEFORE the money arrives.
  const nav = await getBotNav(bot);
  if (!nav) {
    throw new InvestError(
      `${bot.name} holds a token that cannot be priced right now, so its value is unknown. Buying in would be guessing at the price.`
    );
  }

  const units = unitsForDeposit(nav, lamports);
  if (!(units > 0)) throw new InvestError("Could not price units for this bot");

  const tx = await buildSolTransfer(wallet.address, bot.wallet, lamports);
  const signature = await signSendConfirmOneWith(wallet.encryptedKey, tx);

  recordFlow({ bot, nav, userId, kind: "deposit", lamports, units, signature });
  invalidateWallet(bot.wallet);
  invalidateWallet(wallet.address);

  return { botSlug: bot.slug, lamports, units, unitPrice: nav.navPerUnit, signature };
  });
}

export type WithdrawResult = {
  botSlug: string;
  unitsBurned: number;
  /** What they were actually paid, after real slippage on their own slice. */
  lamportsPaid: number;
  /** NAV-implied value, for comparison. Published so the gap is visible. */
  lamportsAtNav: number;
  sold: { mint: string; proceeds: number }[];
  signature: string;
};

/**
 * Take capital back out.
 *
 * Sells the leaver's slice of every position first, then pays idle share plus
 * realised proceeds. Both the NAV-implied figure and the amount actually paid
 * are returned so the slippage is shown rather than buried.
 */
export async function withdrawFromBot(
  userId: number,
  slug: string,
  unitsToBurn: number
): Promise<WithdrawResult> {
  const bot = getBot(slug);
  if (!bot) throw new InvestError("No such bot");

  return withBotLock(bot.id, async () => {
  const held = getUserUnits(userId, bot.id);
  if (!(held.units > 0)) throw new InvestError(`You have no position in ${bot.name}`);

  const units = Math.min(unitsToBurn, held.units);
  if (!(units > 0)) throw new InvestError("Nothing to withdraw");

  const wallet = getAccountWallet(userId);
  if (!wallet) throw new InvestError("Your account has no wallet yet");

  const nav = await getBotNav(bot);
  if (!nav) {
    // Refusing is the honest answer. Settling an exit against a NAV we cannot
    // compute would take real SOL from whoever stays, based on a made-up number.
    throw new InvestError(
      `${bot.name} holds a token that cannot be priced right now, so its value is unknown. Withdrawing would mean settling at a made-up number — try again once pricing recovers.`
    );
  }

  const supply = totalUnits(bot.id);
  if (!(supply > 0)) throw new InvestError("This bot has no units outstanding");

  const share = units / supply;

  // 1. Sell this leaver's slice of every position. Their slippage, not
  //    everybody else's.
  const sold: { mint: string; proceeds: number }[] = [];
  let realised = 0;
  for (const h of nav.holdings) {
    if (h.lamports <= 0) continue;
    try {
      const proceeds = await executeSell(bot, null, h.mint, share);
      realised += proceeds;
      sold.push({ mint: h.mint, proceeds });
    } catch (e) {
      // A leg that cannot be sold must not silently reduce the payout while
      // leaving the units burned — abort before anything is burned.
      throw new InvestError(
        `Could not exit ${h.mint.slice(0, 8)}… for you: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // 2. Their share of the cash that was already idle.
  const idleShare = Math.floor(nav.solLamports * share);
  const grossOwed = idleShare + realised;
  let payout = grossOwed;
  let unitsBurned = units;

  // 3. Never strand the bot below the rent/fee floor.
  invalidateWallet(bot.wallet);
  const botBalance = await getSolBalance(bot.wallet); // lamports
  const spendable = botBalance - WITHDRAW_RESERVE_LAMPORTS;
  if (payout > spendable) {
    payout = spendable;
    // The reserve is biting: we can't pay the full slice without stranding the
    // bot below rent. Burn only the units the payout actually covers, so the
    // leaver keeps a residual position for the unpaid value (now backed by the
    // idle SOL their sales just produced) rather than losing units for nothing.
    if (grossOwed > 0 && payout > 0) {
      unitsBurned = Math.min(units, Math.floor((units * payout) / grossOwed));
    }
  }
  if (payout <= 0 || unitsBurned <= 0) {
    throw new InvestError("Nothing could be realised for your position right now — try again shortly");
  }

  // Re-read NAV after the sales but BEFORE the payout leaves. recordFlow's
  // contract is pre-flow NAV — it closes the trading period at that number and
  // then applies the flow itself. Handing it post-payout NAV subtracted every
  // withdrawal twice: once on-chain, once again inside recordFlow.
  const navAfter = (await getBotNav(bot)) ?? nav;

  const tx = await buildSolTransfer(bot.wallet, wallet.address, payout);
  const signature = await signSendConfirmOneWith(bot.encrypted_key, tx);

  try {
    recordFlow({
      bot,
      nav: navAfter,
      userId,
      kind: "withdraw",
      lamports: -payout,
      units: -unitsBurned,
      signature,
    });
  } catch (e) {
    // The SOL has already left the bot wallet and confirmed on-chain. If the
    // ledger write fails now, the units are NOT yet burned — leaving the
    // position withdrawable again. Log loudly with the signature so boot-time
    // reconcile / an operator can burn them by hand; never swallow this.
    console.error(
      `[CRITICAL] withdraw paid ${payout} lamports (sig ${signature}) but ledger write FAILED for user ${userId} bot ${bot.slug} — units ${unitsBurned} must be burned manually:`,
      e
    );
    throw e;
  }
  invalidateWallet(bot.wallet);
  invalidateWallet(wallet.address);

  // Mid-price value of the units ACTUALLY burned, so the slippage the UI shows
  // (paid vs at-NAV) compares like with like even when the reserve capped the
  // burn to a partial exit.
  const lamportsAtNav = Math.floor(unitsBurned * nav.navPerUnit);
  return { botSlug: bot.slug, unitsBurned, lamportsPaid: payout, lamportsAtNav, sold, signature };
  });
}

/** Everything a user holds across the arena. */
export function myPositions(userId: number): {
  slug: string;
  name: string;
  units: number;
  cost: number;
  sharePct: number;
}[] {
  const rows = getDb()
    .prepare(
      `SELECT b.slug, b.name, b.id, u.units, u.cost_lamports
       FROM bot_units u JOIN bots b ON b.id = u.bot_id
       WHERE u.user_id = ? AND u.units > 0 ORDER BY b.slot`
    )
    .all(userId) as { slug: string; name: string; id: number; units: number; cost_lamports: number }[];

  return rows.map((r) => {
    const supply = totalUnits(r.id);
    return {
      slug: r.slug,
      name: r.name,
      units: r.units,
      cost: r.cost_lamports,
      sharePct: supply > 0 ? (r.units / supply) * 100 : 0,
    };
  });
}

export type { BotRow };
