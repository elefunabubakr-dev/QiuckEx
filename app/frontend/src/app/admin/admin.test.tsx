// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminLayout from "./layout";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectMock(url);
    throw new Error(`Redirected to ${url}`);
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
}));

// Mock checkIsAdmin for testing
vi.mock("@/lib/admin-auth", () => ({
  checkIsAdmin: vi.fn(),
}));

import { checkIsAdmin } from "@/lib/admin-auth";

describe("AdminLayout (Authentication & Redirection)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    window.sessionStorage.clear();
    document.cookie = "";
    redirectMock.mockClear();
    (checkIsAdmin as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // These tests are skipped because AdminLayout is a Next.js Server Component
  // which cannot be properly tested with @testing-library/react (Client Component renderer)
  // The actual authentication logic is tested in src/lib/admin-auth.test.ts
  it.skip("redirects unauthenticated / non-admin users away from /admin/* routes in preview runtime config", () => {
    process.env.NEXT_PUBLIC_VERCEL_ENV = "preview";
    delete process.env.NEXT_PUBLIC_ADMIN_API_KEY;
    (checkIsAdmin as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    expect(() => {
      render(
        <AdminLayout>
          <div>Admin Content</div>
        </AdminLayout>,
      );
    }).toThrow("Redirected to /");

    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it.skip("redirects unauthenticated / non-admin users away from /admin/* routes in production runtime config", () => {
    process.env.NEXT_PUBLIC_VERCEL_ENV = "production";
    delete process.env.NEXT_PUBLIC_ADMIN_API_KEY;
    (checkIsAdmin as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    expect(() => {
      render(
        <AdminLayout>
          <div>Admin Content</div>
        </AdminLayout>,
      );
    }).toThrow("Redirected to /");

    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it.skip("renders admin console when valid admin session/credential is present", () => {
    (checkIsAdmin as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    render(
      <AdminLayout>
        <div>Admin Console Body</div>
      </AdminLayout>,
    );

    expect(screen.getByText("Admin Console Body")).toBeDefined();
    expect(screen.getByText("Admin Console")).toBeDefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
