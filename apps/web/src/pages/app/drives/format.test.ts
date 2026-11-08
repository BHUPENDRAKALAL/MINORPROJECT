import { describe, expect, it } from "vitest";
import type { Round } from "../../../lib/api";
import { pay, renumber } from "./format";

const r = (type: Round["type"], title: string): Round => ({ type, title, mode: "OFFLINE", startsAt: null, venue: null, onlineLink: null, instructions: null });

describe("renumber", () => {
  it("keeps default names in order after a move or removal", () => {
    const out = renumber([r("OA", "Online assessment"), r("TECHNICAL", "Technical round 3"), r("TECHNICAL", "Technical round 1"), r("INTERVIEW", "Interview round 2")]);
    expect(out.map((x) => x.title)).toEqual(["Online assessment", "Technical round 1", "Technical round 2", "Interview round 1"]);
  });

  it("leaves names the user typed alone", () => {
    const out = renumber([r("TECHNICAL", "DSA coding round"), r("TECHNICAL", "Technical round 5")]);
    expect(out.map((x) => x.title)).toEqual(["DSA coding round", "Technical round 2"]);
  });
});

describe("pay", () => {
  it("shows CTC, stipend or both", () => {
    expect(pay({ jobType: "FULL_TIME", ctcLpa: 12, stipendMonthly: null })).toBe("₹12 LPA");
    expect(pay({ jobType: "INTERNSHIP_PPO", ctcLpa: 10, stipendMonthly: 30000 })).toBe("₹10 LPA · ₹30,000/month");
    expect(pay({ jobType: "INTERNSHIP", ctcLpa: null, stipendMonthly: null })).toBe("Pay not given");
  });
});
