import { describe, expect, it } from "vitest";
import { queuesFor } from "./routing.ts";

describe("event routing", () => {
  it("sends shortlist invitations to notifications and webhooks", () => {
    expect(queuesFor("drive.invited").sort()).toEqual(["notify", "webhooks"]);
  });

  it("starts company checks when a company registers", () => {
    expect(queuesFor("company.request_submitted")).toContain("companyChecks");
  });

  it("never sends internal job events to webhooks", () => {
    expect(queuesFor("job.done")).not.toContain("webhooks");
  });
});
