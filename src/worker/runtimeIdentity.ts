import type { Rng, RoomIdentityProvider } from "../shared/index.ts";

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function randomId(prefix: string, rng: Rng): string {
  const value = Math.floor(rng() * Number.MAX_SAFE_INTEGER).toString(36);
  return `${prefix}_${value}`;
}

const UINT32_RANGE = 2 ** 32;

function cryptoRandomUint32(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0];
}

function cryptoRandomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > UINT32_RANGE) {
    throw new Error("Crypto random integer bound must be in the range [1, 2^32]");
  }

  const rejectionLimit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
  let value = cryptoRandomUint32();
  while (value >= rejectionLimit) {
    value = cryptoRandomUint32();
  }
  return value % maxExclusive;
}

export function createCryptoRng(): Rng {
  const rng = (() => cryptoRandomUint32() / UINT32_RANGE) as Rng;
  rng.int = cryptoRandomInt;
  return rng;
}

export function createRuntimeIdentityProvider(secret: string, rng: Rng): RoomIdentityProvider {
  return {
    createPlayerId() {
      return randomId("player", rng);
    },
    createReconnectToken() {
      return randomId("token", rng);
    },
    createPinVerifier(pin, playerId) {
      return `pin-v1:${fnv1a(`${secret}:${playerId}:${pin}`)}`;
    },
    verifyPin(pin, verifier, playerId) {
      return verifier === `pin-v1:${fnv1a(`${secret}:${playerId}:${pin}`)}`;
    },
    hashReconnectToken(token, playerId) {
      return `token-v1:${fnv1a(`${secret}:${playerId}:${token}`)}`;
    }
  };
}
