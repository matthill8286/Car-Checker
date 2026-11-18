/** Upper-cases and strips separators people type into plates and VINs. */
export function normalizeInput(input: string): string {
  return input.toUpperCase().replace(/[\s\-.·_]/g, '');
}

/** Returns a letter/digit shape such as `LLDDLLL`, used to match plate formats. */
export function shapeOf(value: string): string {
  return value.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'D');
}
