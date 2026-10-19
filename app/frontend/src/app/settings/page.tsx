"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { NetworkBadge } from "@/components/NetworkBadge";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import '@/lib/i18n';
import { useTranslation } from "react-i18next";
import { getQuickexApiBase, fetchWithAuth } from "@/lib/api";
import { useWallet } from "@/hooks/useWallet";

/**
 * The editable profile fields, as the backend models them.
 *
 * Every field is nullable on the wire (NULL means "not configured"), but the
 * text inputs cannot hold null, so the form works in `""` throughout and the
 * backend collapses a blank submission back to NULL.
 */
interface ProfileForm {
  primaryColor: string;
  avatarUrl: string;
  bio: string;
  twitterHandle: string;
  discordHandle: string;
  githubHandle: string;
}

const EMPTY_FORM: ProfileForm = {
  primaryColor: "#6366f1",
  avatarUrl: "",
  bio: "",
  twitterHandle: "",
  discordHandle: "",
  githubHandle: "",
};

/** A username claimed by the connected wallet. */
interface OwnedUsername {
  id: string;
  username: string;
  created_at: string;
}

type LoadState = "idle" | "loading" | "ready" | "no-wallet" | "no-username" | "error";

/**
 * Pull a human-usable message out of the backend's error envelope.
 *
 * `GlobalHttpExceptionFilter` produces `{ error: { code, message, fields } }`,
 * and the global `ValidationPipe` puts per-field problems in `fields`. Showing
 * the server's own message beats a generic "something went wrong", because it
 * is the only thing that tells the user which field was rejected.
 */
function describeApiError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return fallback;

  const { message, fields } = error as {
    message?: unknown;
    fields?: Record<string, unknown>;
  };

  const fieldMessages =
    fields && typeof fields === "object"
      ? Object.entries(fields)
          .map(([field, detail]) => `${field}: ${String(detail)}`)
          .join(" ")
      : "";

  const text = typeof message === "string" ? message : "";
  const combined = [text, fieldMessages].filter(Boolean).join(" — ");
  return combined || fallback;
}

export default function Settings() {
  const { t } = useTranslation();
  const { wallet, isRestoring } = useWallet();
  const publicKey = wallet.publicKey;

  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [ownedUsernames, setOwnedUsernames] = useState<OwnedUsername[]>([]);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showPreview, setShowPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * Step 1: find out which usernames this wallet owns.
   *
   * The profile endpoints are keyed by (username, publicKey), so the page has
   * to discover the username before it can load or save a profile. A wallet may
   * own several, so the newest is preselected and the rest stay reachable via a
   * selector.
   */
  useEffect(() => {
    if (isRestoring) return;
    if (!publicKey) {
      setOwnedUsernames([]);
      setSelectedUsername(null);
      setLoadState("no-wallet");
      return;
    }

    let cancelled = false;
    setLoadState("loading");
    setLoadError(null);

    (async () => {
      try {
        const query = new URLSearchParams({ publicKey });
        const res = await fetchWithAuth(
          `${getQuickexApiBase()}/username?${query.toString()}`,
        );
        if (cancelled) return;

        if (!res.ok) {
          setLoadState("error");
          setLoadError(describeApiError(await res.json().catch(() => null), t("settingsLoadFailed")));
          return;
        }

        const data = (await res.json()) as { usernames?: OwnedUsername[] };
        if (cancelled) return;

        const owned = data.usernames ?? [];
        setOwnedUsernames(owned);

        if (owned.length === 0) {
          setSelectedUsername(null);
          setLoadState("no-username");
          return;
        }

        // The backend returns the wallet's usernames oldest-first, so the last
        // entry is the most recently claimed and the likeliest thing to edit.
        setSelectedUsername(owned[owned.length - 1].username);
        setLoadState("idle");
      } catch (err) {
        if (cancelled) return;
        setLoadState("error");
        setLoadError(
          err instanceof Error ? err.message : t("settingsLoadFailed"),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicKey, isRestoring, t]);

  /**
   * Step 2: load the selected profile's current values.
   */
  useEffect(() => {
    if (!publicKey || !selectedUsername) return;

    let cancelled = false;

    (async () => {
      try {
        const query = new URLSearchParams({
          username: selectedUsername,
          publicKey,
        });
        const res = await fetchWithAuth(
          `${getQuickexApiBase()}/profile?${query.toString()}`,
        );
        if (cancelled) return;

        if (!res.ok) {
          setLoadState("error");
          setLoadError(describeApiError(await res.json().catch(() => null), t("settingsLoadFailed")));
          return;
        }

        const data = (await res.json()) as Partial<Record<keyof ProfileForm, string | null>>;
        if (cancelled) return;

        setForm({
          primaryColor: data.primaryColor ?? EMPTY_FORM.primaryColor,
          avatarUrl: data.avatarUrl ?? "",
          bio: data.bio ?? "",
          twitterHandle: data.twitterHandle ?? "",
          discordHandle: data.discordHandle ?? "",
          githubHandle: data.githubHandle ?? "",
        });
        setLoadState("ready");
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        setLoadState("error");
        setLoadError(
          err instanceof Error ? err.message : t("settingsLoadFailed"),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicKey, selectedUsername, t]);

  // Switching profiles must not carry the previous profile's values over.
  const selectUsername = useCallback((username: string) => {
    setSelectedUsername(username);
    setForm(EMPTY_FORM);
    setLoadState("loading");
    setSaveStatus("idle");
    setSaveError(null);
  }, []);

  const canSave = Boolean(publicKey && selectedUsername) && loadState === "ready";

  const handleSave = useCallback(async () => {
    if (!publicKey || !selectedUsername) return;

    setIsSaving(true);
    setSaveStatus("idle");
    setSaveError(null);

    try {
      const res = await fetchWithAuth(`${getQuickexApiBase()}/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: selectedUsername,
          publicKey,
          ...form,
        }),
      });

      if (!res.ok) {
        setSaveError(describeApiError(await res.json().catch(() => null), t("settingsSaveFailed")));
        setSaveStatus("error");
        return;
      }

      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("settingsSaveFailed"));
      setSaveStatus("error");
    } finally {
      setIsSaving(false);
    }
  }, [publicKey, selectedUsername, form, t]);

  const preview = useMemo(() => ({ ...form, username: selectedUsername ?? "" }), [form, selectedUsername]);

  if (loadState === "no-wallet") {
    return (
      <div className="relative min-h-screen text-foreground">
        <NetworkBadge />
        <main className="relative z-10 p-6 sm:p-12 max-w-xl mx-auto">
          <h1 className="text-2xl font-black mb-3">{t("settingsTitle")}</h1>
          <p className="text-subtle text-sm">{t("settingsNoWallet")}</p>
        </main>
      </div>
    );
  }

  if (loadState === "no-username") {
    return (
      <div className="relative min-h-screen text-foreground">
        <NetworkBadge />
        <main className="relative z-10 p-6 sm:p-12 max-w-xl mx-auto">
          <h1 className="text-2xl font-black mb-3">{t("settingsTitle")}</h1>
          <p className="text-subtle text-sm">{t("settingsNoUsername")}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen text-foreground selection:bg-indigo-500/30">
      <NetworkBadge />

      {/* Background glows */}
      <div className="fixed top-[-20%] left-[-30%] w-[60%] h-[60%] bg-indigo-500/10 blur-[120px] rounded-full" />
      <div className="fixed bottom-[-20%] right-[-30%] w-[50%] h-[50%] bg-purple-500/5 blur-[100px] rounded-full" />

      {/* MOBILE HEADER */}
      <div className="md:hidden relative z-10 p-4 border-b border-border bg-card backdrop-blur-3xl">
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard"
            className="text-subtle hover:text-foreground transition"
          >
            ← Back
          </Link>
          <h1 className="text-lg font-black">{t('settingsTitle')}</h1>
          <div className="w-16" /> {/* Spacer for centering */}
        </div>
      </div>

      {/* DESKTOP SIDEBAR */}
      <aside className="hidden md:flex w-72 h-screen fixed left-0 top-0 border-r border-border bg-card backdrop-blur-3xl flex-col z-20">
        <nav className="flex-1 px-4 py-30 space-y-2">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-4 py-3 text-subtle hover:text-foreground hover:bg-surface rounded-2xl font-semibold transition"
          >
            <span>📊</span> Dashboard
          </Link>
          <Link
            href="/generator"
            className="flex items-center gap-3 px-4 py-3 text-subtle hover:text-foreground hover:bg-surface rounded-2xl font-semibold transition"
          >
            <span>⚡</span> Link Generator
          </Link>
          <Link
            href="/settings"
            className="flex items-center gap-3 px-4 py-3 bg-surface border border-border rounded-2xl font-bold"
          >
            <span className="text-indigo-400">⚙️</span> Profile Settings
          </Link>
          <Link
            href="/settings/teams"
            className="flex items-center gap-3 px-4 py-3 text-subtle hover:text-foreground hover:bg-surface rounded-2xl font-semibold transition"
          >
            <span>👥</span> Team Management
          </Link>
        </nav>
      </aside>

      {/* MAIN CONTENT */}
      <main className="relative z-10 p-4 sm:p-6 md:p-12 md:ml-72 pb-24 md:pb-12">
        {/* Header - Hidden on mobile, shown on desktop */}
        <header className="hidden md:block mb-10">
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-2">
            {t('profileCustomization')}
          </h1>
          <p className="text-subtle font-medium text-sm sm:text-base">
            {t('profileCustomizationDescription', { username: selectedUsername ?? "…" })}
          </p>
        </header>

        {/* Mobile subheader */}
        <div className="md:hidden mb-6">
          <p className="text-subtle text-sm">
            {t('profileCustomizationDescription', { username: selectedUsername ?? "…" })}
          </p>
        </div>

        <nav className="flex gap-3 mb-8">
          <Link
            href="/settings"
            className="px-4 py-2 rounded-xl border border-border-strong bg-surface-strong text-sm font-semibold hover:bg-surface-strong"
          >
            {t('generalTab')}
          </Link>
          <Link
            href="/settings/teams"
            className="px-4 py-2 rounded-xl border border-border-strong bg-surface-strong text-sm font-semibold hover:bg-surface"
          >
            Team
          </Link>
          <Link
            href="/settings/developer"
            className="px-4 py-2 rounded-xl border border-border-strong bg-surface-strong text-sm font-semibold hover:bg-surface"
          >
            {t('developerTab')}
          </Link>
        </nav>

        {loadState === "error" && (
          <div className="mb-6 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            {loadError ?? t("settingsLoadFailed")}
          </div>
        )}

        {loadState === "loading" && (
          <div className="mb-6 rounded-2xl border border-border bg-card p-4 text-sm text-subtle">
            {t("settingsLoadingProfile")}
          </div>
        )}

        {ownedUsernames.length > 1 && (
          <div className="mb-6 max-w-sm">
            <label className="block text-xs sm:text-sm font-bold text-subtle mb-2">
              {t("settingsEditingProfile")}
            </label>
            <select
              value={selectedUsername ?? ""}
              onChange={(e) => selectUsername(e.target.value)}
              className="w-full px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl bg-surface border border-border-strong text-foreground text-sm sm:text-base"
            >
              {ownedUsernames.map((entry) => (
                <option key={entry.id} value={entry.username}>
                  @{entry.username}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">

          {/* Settings Form */}
          <div className="space-y-4 sm:space-y-6">
            {/* Theme Settings Card */}
            <div className="rounded-2xl sm:rounded-3xl bg-card border border-border p-5 sm:p-6 md:p-8">
              <h2 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6">
                {t('themeSettings')}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs sm:text-sm font-bold text-subtle mb-2">
                    {t('primaryColor')}
                  </label>
                  <div className="flex gap-2 sm:gap-3">
                    <input
                      type="color"
                      value={form.primaryColor}
                      onChange={(e) =>
                        setForm({ ...form, primaryColor: e.target.value })
                      }
                      className="w-14 sm:w-16 h-11 sm:h-12 rounded-xl border border-border-strong bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={form.primaryColor}
                      onChange={(e) =>
                        setForm({ ...form, primaryColor: e.target.value })
                      }
                      className="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl bg-surface border border-border-strong text-foreground font-mono text-sm sm:text-base"
                      placeholder="#6366f1"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-bold text-subtle mb-2">
                    {t('avatarUrl')}
                  </label>
                  <input
                    type="url"
                    value={form.avatarUrl}
                    onChange={(e) =>
                      setForm({ ...form, avatarUrl: e.target.value })
                    }
                    className="w-full px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl bg-surface border border-border-strong text-foreground text-sm sm:text-base"
                    placeholder="https://example.com/avatar.jpg"
                  />
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-bold text-subtle mb-2">
                    {t('bioLabel')}
                  </label>
                  <textarea
                    value={form.bio}
                    onChange={(e) => setForm({ ...form, bio: e.target.value })}
                    maxLength={160}
                    rows={3}
                    className="w-full px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl bg-surface border border-border-strong text-foreground resize-none text-sm sm:text-base"
                    placeholder="Building the future of payments on Stellar"
                  />
                  <p className="text-xs text-faint mt-1">
                    {form.bio.length}/160 characters
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl sm:rounded-3xl bg-card border border-border p-5 sm:p-6 md:p-8">
              <h2 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6">
                {t('languageLabel')}
              </h2>
              <p className="text-sm text-subtle mb-4">
                {t('changeLanguage')}
              </p>
              <LocaleSwitcher />
            </div>

            {/* Social Links Card */}
            <div className="rounded-2xl sm:rounded-3xl bg-card border border-border p-5 sm:p-6 md:p-8">
              <h2 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6">
                {t('socialLinks')}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs sm:text-sm font-bold text-subtle mb-2">
                    {t('twitterHandleLabel')}
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-subtle text-sm sm:text-base">
                      @
                    </span>
                    <input
                      type="text"
                      value={form.twitterHandle}
                      onChange={(e) =>
                        setForm({ ...form, twitterHandle: e.target.value })
                      }
                      className="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl bg-surface border border-border-strong text-foreground text-sm sm:text-base"
                      placeholder="stellarorg"
                      maxLength={15}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-bold text-subtle mb-2">
                    {t('discordUsernameLabel')}
                  </label>
                  <input
                    type="text"
                    value={form.discordHandle}
                    onChange={(e) =>
                      setForm({ ...form, discordHandle: e.target.value })
                    }
                    className="w-full px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl bg-surface border border-border-strong text-foreground text-sm sm:text-base"
                    placeholder="user#1234"
                    maxLength={32}
                  />
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-bold text-subtle mb-2">
                    {t('githubHandleLabel')}
                  </label>
                  <input
                    type="text"
                    value={form.githubHandle}
                    onChange={(e) =>
                      setForm({ ...form, githubHandle: e.target.value })
                    }
                    className="w-full px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl bg-surface border border-border-strong text-foreground text-sm sm:text-base"
                    placeholder="stellar"
                    maxLength={39}
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons - Desktop */}
            <div className="hidden sm:flex flex-col gap-2">
              <div className="flex gap-3 sm:gap-4">
                <button
                  onClick={handleSave}
                  disabled={isSaving || !canSave}
                  className="flex-1 px-4 sm:px-6 py-3 sm:py-4 bg-indigo-500 text-white font-bold rounded-xl hover:scale-105 active:scale-95 transition text-sm sm:text-base disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
                >
                  {isSaving ? t('settingsSaving') : t('saveChanges')}
                </button>
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className="px-4 sm:px-6 py-3 sm:py-4 bg-surface border border-border-strong text-foreground font-bold rounded-xl hover:bg-surface-strong transition text-sm sm:text-base whitespace-nowrap"
                >
                  {showPreview ? t('hide') : t('show')} {t('preview')}
                </button>
              </div>
              {saveStatus === "success" && <p className="text-sm text-green-500 font-medium px-1">{t('settingsProfileSaved')}</p>}
              {saveStatus === "error" && (
                <p className="text-sm text-red-500 font-medium px-1">
                  {saveError ?? t('settingsSaveFailed')}
                </p>
              )}
            </div>
          </div>

          {/* Live Preview - Desktop */}
          {showPreview && (
            <div className="hidden lg:block lg:sticky lg:top-12 h-fit">
              <div className="rounded-3xl bg-card border border-border p-8">
                <h2 className="text-xl font-bold mb-6">{t('livePreview')}</h2>
                <div className="rounded-2xl border border-border-strong overflow-hidden bg-background">
                  <ProfilePreview {...preview} />
                </div>
              </div>
            </div>
          )}

          {/* Live Preview - Mobile/Tablet (when toggled) */}
          {showPreview && (
            <div className="lg:hidden rounded-2xl sm:rounded-3xl bg-card border border-border p-5 sm:p-6 md:p-8">
              <h2 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6">
                {t('livePreview')}
              </h2>
              <div className="rounded-2xl border border-border-strong overflow-hidden bg-background">
                <ProfilePreview {...preview} />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* MOBILE BOTTOM BAR */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-30 p-4 bg-card backdrop-blur-3xl border-t border-border flex flex-col gap-2">
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={isSaving || !canSave}
            className="flex-1 px-4 py-3 bg-indigo-500 text-white font-bold rounded-xl active:scale-95 transition disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
          >
            {isSaving ? t('settingsSaving') : t('saveChanges')}
          </button>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="px-4 py-3 bg-surface border border-border-strong text-foreground font-bold rounded-xl active:scale-95 transition"
          >
            {showPreview ? t('hide') : t('show')} {t('preview')}
          </button>
        </div>
        {saveStatus === "success" && <p className="text-sm text-green-500 font-medium text-center">{t('settingsProfileSaved')}</p>}
        {saveStatus === "error" && (
          <p className="text-sm text-red-500 font-medium text-center">
            {saveError ?? t('settingsSaveFailed')}
          </p>
        )}
      </div>
    </div>
  );
}

function ProfilePreview({
  username,
  primaryColor,
  avatarUrl,
  bio,
  twitterHandle,
  discordHandle,
  githubHandle,
}: {
  username: string;
  primaryColor: string;
  avatarUrl: string;
  bio: string;
  twitterHandle: string;
  discordHandle: string;
  githubHandle: string;
}) {
  return (
    <div className="p-6 sm:p-8 text-center">
      {/* Avatar */}
      <div className="flex justify-center mb-4 sm:mb-6">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={username}
            width={96}
            height={96}
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 object-cover"
            style={{ borderColor: primaryColor }}
          />
        ) : (
          <div
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 flex items-center justify-center text-2xl sm:text-3xl font-black"
            style={{ borderColor: primaryColor, color: primaryColor }}
          >
            {username[0]?.toUpperCase()}
          </div>
        )}
      </div>

      {/* Username */}
      <h1 className="text-xl sm:text-2xl font-black mb-2">@{username}</h1>

      {/* Bio */}
      {bio && (
        <p className="text-subtle text-xs sm:text-sm mb-4 sm:mb-6 px-2">
          {bio}
        </p>
      )}

      {/* Social Links */}
      {(twitterHandle || discordHandle || githubHandle) && (
        <div className="flex justify-center gap-2 sm:gap-3 mb-4 sm:mb-6">
          {twitterHandle && (
            <a
              href={`https://twitter.com/${twitterHandle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-surface hover:bg-surface-strong flex items-center justify-center transition text-sm sm:text-base"
              style={{ color: primaryColor }}
            >
              𝕏
            </a>
          )}
          {discordHandle && (
            <div
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-surface flex items-center justify-center text-sm sm:text-base"
              style={{ color: primaryColor }}
            >
              💬
            </div>
          )}
          {githubHandle && (
            <a
              href={`https://github.com/${githubHandle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-surface hover:bg-surface-strong flex items-center justify-center transition text-sm sm:text-base"
              style={{ color: primaryColor }}
            >
              🐙
            </a>
          )}
        </div>
      )}

      {/* Payment Button */}
      <button
        className="w-full py-3 sm:py-4 rounded-xl font-bold text-foreground transition hover:opacity-90 text-sm sm:text-base"
        style={{ backgroundColor: primaryColor }}
      >
        Send Payment
      </button>
    </div>
  );
}
