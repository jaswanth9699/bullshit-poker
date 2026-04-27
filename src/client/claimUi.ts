import {
  getLegalClaimsAfter,
  type Card,
  type Claim,
  type ClaimTemplate,
  type HandType,
  type Rank,
  type Suit
} from "../shared/index.ts";

export const HAND_TYPE_LABELS: Record<HandType, string> = {
  HIGH_CARD: "High Card",
  PAIR: "Pair",
  TWO_PAIR: "Two Pair",
  THREE_OF_A_KIND: "Three of a Kind",
  STRAIGHT: "Straight",
  FLUSH: "Flush",
  FULL_HOUSE: "Full House",
  FOUR_OF_A_KIND: "Four of a Kind",
  STRAIGHT_FLUSH: "Straight Flush",
  ROYAL_FLUSH: "Royal Flush"
};

export const RANK_WORDS: Record<Rank, string> = {
  "2": "Twos",
  "3": "Threes",
  "4": "Fours",
  "5": "Fives",
  "6": "Sixes",
  "7": "Sevens",
  "8": "Eights",
  "9": "Nines",
  "10": "Tens",
  J: "Jacks",
  Q: "Queens",
  K: "Kings",
  A: "Aces"
};

export const RANK_SHORT: Record<Rank, string> = {
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  "10": "10",
  J: "J",
  Q: "Q",
  K: "K",
  A: "A"
};

const SUIT_SYMBOLS: Record<Suit, string> = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣"
};

export function playerName(players: readonly { id: string; name: string }[], playerId?: string): string {
  if (!playerId) return "None";
  return players.find((player) => player.id === playerId)?.name ?? playerId;
}

export function formatCard(card: Card): string {
  return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
}

export function cardTone(card: Card): "red" | "black" {
  return card.suit === "H" || card.suit === "D" ? "red" : "black";
}

export function claimKey(claim: Claim): string {
  return [
    claim.handType,
    claim.primaryRank ?? "",
    claim.secondaryRank ?? "",
    claim.suit ?? ""
  ].join(":");
}

export function formatClaim(claim?: Claim): string {
  if (!claim) return "No claim yet";

  switch (claim.handType) {
    case "HIGH_CARD":
      return `High Card ${claim.primaryRank}`;
    case "PAIR":
      return `Pair of ${RANK_WORDS[claim.primaryRank!]}`;
    case "TWO_PAIR":
      return `Two Pair ${RANK_WORDS[claim.primaryRank!]} / ${RANK_WORDS[claim.secondaryRank!]}`;
    case "THREE_OF_A_KIND":
      return `Three ${RANK_WORDS[claim.primaryRank!]}`;
    case "STRAIGHT":
      return `${claim.primaryRank}-high Straight`;
    case "FLUSH":
      return `${claim.primaryRank}-high ${SUIT_SYMBOLS[claim.suit!]} Flush`;
    case "FULL_HOUSE":
      return `${RANK_WORDS[claim.primaryRank!]} over ${RANK_WORDS[claim.secondaryRank!]}`;
    case "FOUR_OF_A_KIND":
      return `Four ${RANK_WORDS[claim.primaryRank!]}`;
    case "STRAIGHT_FLUSH":
      return `${claim.primaryRank}-high ${SUIT_SYMBOLS[claim.suit!]} Straight Flush`;
    case "ROYAL_FLUSH":
      return `${SUIT_SYMBOLS[claim.suit!]} Royal Flush`;
  }
}

export function compactClaim(claim: Claim): string {
  if (claim.handType === "TWO_PAIR") {
    return `2P ${RANK_SHORT[claim.primaryRank!]}/${RANK_SHORT[claim.secondaryRank!]}`;
  }
  if (claim.handType === "FULL_HOUSE") {
    return `FH ${RANK_SHORT[claim.primaryRank!]}/${RANK_SHORT[claim.secondaryRank!]}`;
  }
  if (claim.handType === "ROYAL_FLUSH") {
    return `RF ${SUIT_SYMBOLS[claim.suit!]}`;
  }
  if (claim.suit) {
    return `${HAND_TYPE_LABELS[claim.handType]} ${RANK_SHORT[claim.primaryRank!]}${SUIT_SYMBOLS[claim.suit]}`;
  }
  return `${HAND_TYPE_LABELS[claim.handType]} ${claim.primaryRank ?? ""}`;
}

export function legalClaimsByHandType(currentClaim?: Claim): Array<{
  handType: HandType;
  label: string;
  claims: ClaimTemplate[];
}> {
  const groups = new Map<HandType, ClaimTemplate[]>();
  for (const claim of getLegalClaimsAfter(currentClaim)) {
    const claims = groups.get(claim.handType) ?? [];
    claims.push(claim);
    groups.set(claim.handType, claims);
  }

  return [...groups.entries()].map(([handType, claims]) => ({
    handType,
    label: HAND_TYPE_LABELS[handType],
    claims
  }));
}
