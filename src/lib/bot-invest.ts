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

  const wallet = getAccountWallet(userId);
  if (!wallet) throw new InvestError("Your account has no wallet yet");

  const balance = Math.floor((await getSolBalance(wallet.address)) * LAMPORTS_PER_SOL);
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
  const lamportsAtNav = Math.floor(units * nav.navPerUnit);

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
  let payout = idleShare + realised;

  // 3. Never strand the bot below the rent/fee floor.
  invalidateWallet(bot.wallet);
  const botBalance = Math.floor((await getSolBalance(bot.wallet)) * LAMPORTS_PER_SOL);
  const spendable = botBalance - WITHDRAW_RESERVE_LAMPORTS;
  if (payout > spendable) payout = spendable;
  if (payout <= 0) throw new InvestError("Nothing could be realised for your position");

  const tx = await buildSolTransfer(bot.wallet, wallet.address, payout);
  const signature = await signSendConfirmOneWith(bot.encrypted_key, tx);

  // Re-read NAV after the sales so the flow is priced against the book that
  // actually exists now, not the one that existed before the exit.
  const navAfter = (await getBotNav(bot)) ?? nav;
  recordFlow({
    bot,
    nav: navAfter,
    userId,
    kind: "withdraw",
    lamports: -payout,
    units: -units,
    signature,
  });
  invalidateWallet(bot.wallet);
  invalidateWallet(wallet.address);

  return { botSlug: bot.slug, unitsBurned: units, lamportsPaid: payout, lamportsAtNav, sold, signature };
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
