import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Rng, RoomIdentityProvider } from "../shared/index.ts";

function keyedDigest(secret: string, purpose: string, value: string): string {
  return bytesToHex(
    hmac(sha256, utf8ToBytes(secret), utf8ToBytes(`${purpose}:${value}`)),
  );
}

function randomToken(prefix: string, byteLength: number): string {
  const values = new Uint8Array(byteLength);
  crypto.getRandomValues(values);
  return `${prefix}_${bytesToHex(values)}`;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

const UINT32_RANGE = 2 ** 32;

function cryptoRandomUint32(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0];
}

function cryptoRandomInt(maxExclusive: number): number {
  if (
    !Number.isSafeInteger(maxExclusive) ||
    maxExclusive <= 0 ||
    maxExclusive > UINT32_RANGE
  ) {
    throw new Error(
      "Crypto random integer bound must be in the range [1, 2^32]",
    );
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

export function createRuntimeIdentityProvider(
  secret: string,
): RoomIdentityProvider {
  return {
    createPlayerId() {
      return randomToken("player", 16);
    },
    createReconnectToken() {
      return randomToken("token", 32);
    },
    createPinVerifier(pin, playerId) {
      return `pin-v2:${keyedDigest(secret, "pin", `${playerId}:${pin}`)}`;
    },
    verifyPin(pin, verifier, playerId) {
      return constantTimeEqual(
        verifier,
        `pin-v2:${keyedDigest(secret, "pin", `${playerId}:${pin}`)}`,
      );
    },
    hashReconnectToken(token, playerId) {
      return `token-v2:${keyedDigest(secret, "reconnect", `${playerId}:${token}`)}`;
    },
  };
}
