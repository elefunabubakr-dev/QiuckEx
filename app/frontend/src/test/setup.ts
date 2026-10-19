import { vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "username" in opts ? `${key}:${String(opts.username)}` : key,
  }),
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
}));

vi.mock("@/lib/i18n", () => ({
  default: {
    language: "en",
    changeLanguage: vi.fn(),
    on: vi.fn(),
  },
}));