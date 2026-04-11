/** Return true if the person born on `dob` is at least `minAge` years old today. */
export function isAtLeastAge(dob: Date, minAge: number): boolean {
  const today = new Date();
  const cutoff = new Date(
    today.getFullYear() - minAge,
    today.getMonth(),
    today.getDate(),
  );
  return dob <= cutoff;
}

/** Compute age from a DOB string (YYYY-MM-DD) using local time. */
export function getAgeFromDob(dob: string): number {
  const birth = new Date(dob + "T00:00:00");
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

/** Default age preference range: ±5 years from user's age, clamped to 18-80. */
export function getDefaultAgeRange(userAge: number): [number, number] {
  return [Math.max(18, userAge - 5), Math.min(80, userAge + 5)];
}
