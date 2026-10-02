/**
 * All world-space units in this project are FEET unless explicitly labeled otherwise.
 * One Three.js scene unit == one foot. This keeps layout math directly readable
 * against real-world striping specs (stall widths, line widths, aisle widths).
 */

export const STANDARD_STALL_WIDTH_FT = 9;
export const STANDARD_STALL_DEPTH_FT = 18;
export const STANDARD_AISLE_WIDTH_FT = 24;

export const STRIPE_LINE_WIDTH_IN = 4;
export const STRIPE_LINE_WIDTH_FT = STRIPE_LINE_WIDTH_IN / 12;

export function feetAndInches(totalFeet: number): string {
  const whole = Math.floor(totalFeet);
  const inches = Math.round((totalFeet - whole) * 12);
  if (inches === 0) return `${whole}'`;
  if (inches === 12) return `${whole + 1}'`;
  return `${whole}' ${inches}"`;
}

export function inchesToFeet(inches: number): number {
  return inches / 12;
}
