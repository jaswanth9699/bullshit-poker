export function normalizeDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

export function validatePlayerPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export function assertValidPlayerPin(pin: string): void {
  if (!validatePlayerPin(pin)) {
    throw new Error("Player PIN must be exactly 4 digits");
  }
}
