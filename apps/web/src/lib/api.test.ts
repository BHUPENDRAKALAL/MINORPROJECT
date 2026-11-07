import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, getSession, onSessionLost, refreshSession, resetSessionForTests, setSessionFromTokens, type Tokens } from "./api";

const tokens = (accessToken: string): Tokens => ({
  accessToken,
  accessTokenExpiresIn: 900,
  user: { id: "u1", email: "a@b.c", name: "A", roles: ["STUDENT"] },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sessionError = (code = "TOKEN_INVALID") =>
  json(401, { error: { code, message: "Your session has expired. Please sign in again." } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetSessionForTests();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function urlOf(call: unknown[]): string {
  return String(call[0]);
}
function authOf(call: unknown[]): string | undefined {
  return ((call[1] as RequestInit).headers as Record<string, string>).Authorization;
}

describe("refreshSession", () => {
  it("shares one request between concurrent callers", async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (release = r)));

    const a = refreshSession();
    const b = refreshSession();
    const c = refreshSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock.mock.calls[0])).toBe("/api/v1/auth/refresh");
    expect((fetchMock.mock.calls[0][1] as RequestInit).credentials).toBe("include");

    release(json(200, tokens("fresh")));
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra?.accessToken).toBe("fresh");
    expect(rb).toBe(ra);
    expect(rc).toBe(ra);
    expect(getSession().accessToken).toBe("fresh");

    // Once settled, the next call makes a new request.
    fetchMock.mockResolvedValueOnce(json(200, tokens("fresher")));
    await refreshSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears the session when the server says it ended", async () => {
    setSessionFromTokens(tokens("old"));
    fetchMock.mockResolvedValueOnce(sessionError("SESSION_ENDED"));
    expect(await refreshSession()).toBeNull();
    expect(getSession().accessToken).toBeNull();
  });
});

describe("api() on 401", () => {
  it("refreshes once and retries the request with the new token", async () => {
    setSessionFromTokens(tokens("stale"));
    fetchMock
      .mockResolvedValueOnce(sessionError("TOKEN_INVALID")) // GET /me with stale token
      .mockResolvedValueOnce(json(200, tokens("fresh"))) // POST /auth/refresh
      .mockResolvedValueOnce(json(200, { id: "u1" })); // GET /me again

    const me = await api<{ id: string }>("/me");
    expect(me).toEqual({ id: "u1" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(authOf(fetchMock.mock.calls[0])).toBe("Bearer stale");
    expect(urlOf(fetchMock.mock.calls[1])).toBe("/api/v1/auth/refresh");
    expect(authOf(fetchMock.mock.calls[2])).toBe("Bearer fresh");
  });

  it("uses a single refresh when several requests fail together", async () => {
    setSessionFromTokens(tokens("stale"));
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith("/auth/refresh")) {
        await new Promise((r) => setTimeout(r, 5));
        return json(200, tokens("fresh"));
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Bearer fresh" ? json(200, { url }) : sessionError();
    });

    const results = await Promise.all([api("/a"), api("/b"), api("/c")]);
    expect(results).toHaveLength(3);
    const refreshCalls = fetchMock.mock.calls.filter((c) => urlOf(c).endsWith("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });

  it("reports a lost session when the refresh fails, and throws the original error", async () => {
    setSessionFromTokens(tokens("stale"));
    const lost = vi.fn();
    onSessionLost(lost);
    fetchMock.mockResolvedValueOnce(sessionError("SESSION_ENDED")).mockResolvedValueOnce(sessionError("SESSION_ENDED"));

    await expect(api("/me")).rejects.toMatchObject({ status: 401, code: "SESSION_ENDED" });
    expect(lost).toHaveBeenCalledTimes(1);
    expect(getSession().accessToken).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not refresh for other 401s or for public routes", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: "INVALID_CREDENTIALS", message: "Wrong email or password." } }));
    await expect(api("/auth/login", { method: "POST", body: {}, auth: false })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Wrong email or password.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exposes validation issues as field errors", async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, {
        error: {
          code: "VALIDATION_FAILED",
          message: "Some fields are missing or invalid.",
          details: { in: "body", issues: [{ path: "email", message: "Enter a valid email address." }] },
        },
      }),
    );
    const err = await api("/auth/login", { method: "POST", body: {}, auth: false }).catch((e: unknown) => e);
    expect((err as { fieldErrors: Record<string, string> }).fieldErrors).toEqual({ email: "Enter a valid email address." });
  });
});
