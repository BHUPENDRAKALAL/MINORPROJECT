/** How strong a new password looks, with the one change that would help most. Advice only: the API rule is passwordProblem(). */
export interface Strength {
  /** 0 = empty, 1 weak, 2 okay, 3 good, 4 strong */
  score: 0 | 1 | 2 | 3 | 4;
  label: "" | "Weak" | "Okay" | "Good" | "Strong";
  tip: string;
}

const COMMON = ["password", "12345678", "123456789", "qwerty", "iloveyou", "admin", "welcome", "letmein", "cyrus", "mbm", "abcd1234", "password1", "11111111"];

export function passwordStrength(pw: string): Strength {
  if (!pw) return { score: 0, label: "", tip: "At least 8 characters. Longer is stronger." };
  const lower = pw.toLowerCase();
  if (COMMON.some((c) => lower.includes(c)) || /^(.)\1+$/.test(pw)) return { score: 1, label: "Weak", tip: "This is easy to guess. Avoid common words and repeats." };
  if (pw.length < 8) return { score: 1, label: "Weak", tip: `Add ${8 - pw.length} more character${8 - pw.length === 1 ? "" : "s"}.` };
  if (/^\d+$/.test(pw)) return { score: 1, label: "Weak", tip: "Add letters too, not only numbers." };

  const checks = [
    { ok: pw.length >= 12, tip: "Make it 12 characters or more." },
    { ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw), tip: "Mix capital and small letters." },
    { ok: /\d/.test(pw), tip: "Add a number." },
    { ok: /[^A-Za-z0-9]/.test(pw), tip: "Add a symbol like ! # or @." },
  ];
  const passed = checks.filter((c) => c.ok).length;
  const score = (passed >= 3 && pw.length >= 12 ? 4 : passed >= 2 ? 3 : 2) as 2 | 3 | 4;
  const next = checks.find((c) => !c.ok);
  return { score, label: score === 4 ? "Strong" : score === 3 ? "Good" : "Okay", tip: next ? next.tip : "Nice. Keep it to yourself." };
}
