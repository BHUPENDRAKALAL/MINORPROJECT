import { describe, expect, it } from "vitest";
import { groupNav, navFor } from "./nav";

const shape = (role: Parameters<typeof navFor>[0]) => groupNav(navFor(role)).map((g) => [g.label ?? "", g.items.map((i) => i.label)]);

describe("side panel groups", () => {
  it("TPO: top, Students, Placements, Administration", () => {
    expect(shape("TPO")).toEqual([
      ["", ["Overview", "Notifications"]],
      ["Students", ["Review queue", "Students"]],
      ["Placements", ["Drives", "Companies"]],
      ["Administration", ["Team", "Settings"]],
    ]);
  });

  it("staff don't get an empty Administration group", () => {
    expect(shape("STAFF").map(([label]) => label)).toEqual(["", "Students", "Placements"]);
  });

  it("student, HR and interviewer", () => {
    expect(shape("STUDENT")).toEqual([
      ["", ["Home", "Notifications"]],
      ["Placements", ["Drives", "My profile"]],
    ]);
    expect(shape("COMPANY_HR")).toEqual([
      ["", ["Drives", "Notifications"]],
      ["Company", ["Team", "Company profile"]],
    ]);
    expect(shape("INTERVIEWER")).toEqual([["", ["My panels", "Notifications"]]]);
  });
});
