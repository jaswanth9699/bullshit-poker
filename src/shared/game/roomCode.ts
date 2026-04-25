import type { Rng } from "../cards/cardTypes.ts";

export const ROOM_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const DEFAULT_ROOM_CODE_LENGTH = 6;

export function generateRoomCode(rng: Rng, length = DEFAULT_ROOM_CODE_LENGTH): string {
  let code = "";

  for (let index = 0; index < length; index += 1) {
    const value = rng();
    if (value < 0 || value >= 1) {
      throw new Error("RNG must return a number in the range [0, 1)");
    }
    code += ROOM_CODE_CHARS.charAt(Math.floor(value * ROOM_CODE_CHARS.length));
  }

  return code;
}
