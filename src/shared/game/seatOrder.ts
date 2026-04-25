export type SeatPlayer = {
  id: string;
  seatIndex: number;
  eliminated?: boolean;
  leftAt?: number;
};

export function activeSeatPlayers(players: readonly SeatPlayer[]): SeatPlayer[] {
  return [...players]
    .filter((player) => !player.eliminated && player.leftAt === undefined)
    .sort((left, right) => left.seatIndex - right.seatIndex);
}

export function determineNextRoundStarter(
  players: readonly SeatPlayer[],
  previousStartingPlayerId: string
): string | null {
  const orderedPlayers = [...players].sort((left, right) => left.seatIndex - right.seatIndex);
  const activePlayers = activeSeatPlayers(orderedPlayers);

  if (activePlayers.length <= 1) {
    return null;
  }

  const previousStarter = orderedPlayers.find((player) => player.id === previousStartingPlayerId);
  if (!previousStarter) {
    throw new Error(`Previous starter not found: ${previousStartingPlayerId}`);
  }

  const previousStarterIndex = orderedPlayers.findIndex((player) => player.id === previousStarter.id);

  for (let offset = 1; offset <= orderedPlayers.length; offset += 1) {
    const candidateIndex = (previousStarterIndex + offset) % orderedPlayers.length;
    const candidate = orderedPlayers[candidateIndex];
    if (candidate && !candidate.eliminated && candidate.leftAt === undefined) {
      return candidate.id;
    }
  }

  return null;
}

export function advanceToNextActivePlayer(players: readonly SeatPlayer[], currentPlayerId: string): string | null {
  const orderedPlayers = [...players].sort((left, right) => left.seatIndex - right.seatIndex);
  const activePlayers = activeSeatPlayers(orderedPlayers);

  if (activePlayers.length <= 1) {
    return null;
  }

  const currentIndex = orderedPlayers.findIndex((player) => player.id === currentPlayerId);
  if (currentIndex === -1) {
    throw new Error(`Current player not found: ${currentPlayerId}`);
  }

  for (let offset = 1; offset <= orderedPlayers.length; offset += 1) {
    const candidate = orderedPlayers[(currentIndex + offset) % orderedPlayers.length];
    if (candidate && !candidate.eliminated && candidate.leftAt === undefined) {
      return candidate.id;
    }
  }

  return null;
}
