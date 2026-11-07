import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSessionForTests } from "../../lib/api";
import SignUp from "./SignUp";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetSessionForTests();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSignUp() {
  return render(
    <MemoryRouter initialEntries={["/sign-up"]}>
      <Routes>
        <Route path="/sign-up" element={<SignUp />} />
        <Route path="/verify-email" element={<p>verify page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillValid() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Roll number"), "21CS001");
  await user.type(screen.getByLabelText("Full name"), "Asha Verma");
  await user.selectOptions(screen.getByLabelText("Branch"), "CSE");
  await user.type(screen.getByLabelText("Email"), "asha@example.com");
  await user.type(screen.getByLabelText("Password"), "goodpass1");
  return user;
}

describe("Student sign-up form", () => {
  it("shows the API's field errors next to each field", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_FAILED",
            message: "Some fields are missing or invalid.",
            details: {
              in: "body",
              issues: [
                { path: "email", message: "Enter a valid email address." },
                { path: "rollNo", message: "Roll number looks wrong." },
              ],
            },
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    renderSignUp();
    const user = await fillValid();
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Some fields are missing or invalid.");
    const email = screen.getByLabelText("Email");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(email.getAttribute("aria-describedby")!)?.textContent).toBe("Enter a valid email address.");
    expect(screen.getByText("Roll number looks wrong.")).toBeTruthy();
  });

  it("checks fields before sending and does not call the API", async () => {
    renderSignUp();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Password"), "12345678");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByText("Enter your roll number.")).toBeTruthy();
    expect(screen.getByText("Use letters or symbols too, not only numbers.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows EMAIL_TAKEN on the email field and moves on after success", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "EMAIL_TAKEN", message: "This email is already registered." } }), { status: 409 }),
    );
    renderSignUp();
    const user = await fillValid();
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findAllByText("This email is already registered.")).toHaveLength(2);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ email: "asha@example.com", next: "verify-email" }), { status: 201 }));
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("verify page")).toBeTruthy();
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body).toMatchObject({ rollNo: "21CS001", branch: "CSE", email: "asha@example.com", batch: expect.any(Number) });
  });
});
