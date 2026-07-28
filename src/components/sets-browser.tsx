"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { FieldSelect } from "@/components/ui/field-select";
import type { PokemonTcgSet } from "@/lib/pokemon-tcg/types";

type SetsBrowserProps = {
  sets: PokemonTcgSet[];
  collectionProgress?: Record<string, number> | null;
};

type LanguageFilter = "all" | "en" | "ja";

const languageOptions = [
  { value: "all", label: "All languages" },
  { value: "en", label: "English" },
  { value: "ja", label: "Japanese" },
] as const;

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function setMatchesQuery(set: PokemonTcgSet, normalizedQuery: string) {
  if (!normalizedQuery) return true;

  const searchableText = normalizeSearchText(
    [
      set.name,
      set.series,
      set.id,
      set.releaseDate,
      set.languageCode,
      set.languageCode === "ja" ? "Japanese" : "English",
    ]
      .filter(Boolean)
      .join(" "),
  );

  return normalizedQuery.split(" ").every((token) => searchableText.includes(token));
}

export function SetsBrowser({ sets, collectionProgress }: SetsBrowserProps) {
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState<LanguageFilter>("all");
  const [currentCollectionProgress, setCurrentCollectionProgress] = useState(collectionProgress);
  const normalizedQuery = normalizeSearchText(query);
  const filteredSets = useMemo(
    () =>
      sets.filter(
        (set) =>
          (language === "all" ||
            (set.languageCode === "ja" ? "ja" : "en") === language) &&
          setMatchesQuery(set, normalizedQuery),
      ),
    [language, normalizedQuery, sets],
  );

  useEffect(() => {
    if (collectionProgress !== undefined) {
      return;
    }

    let active = true;

    async function loadCollectionProgress() {
      try {
        const response = await fetch("/api/sets/progress", {
          cache: "no-store",
          credentials: "same-origin",
        });

        if (!response.ok) return;

        const data = (await response.json()) as { progress: Record<string, number> | null };
        if (active) setCurrentCollectionProgress(data.progress);
      } catch {
        if (active) setCurrentCollectionProgress(null);
      }
    }

    void loadCollectionProgress();

    return () => {
      active = false;
    };
  }, [collectionProgress]);

  return (
    <section className="mt-10">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem] lg:grid-cols-[minmax(0,1fr)_12rem_auto] lg:items-end">
        <label className="block">
          <span className="auth-label">Find a set</span>
          <input
            className="auth-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search set names, series, or years"
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="auth-label">Language</span>
          <FieldSelect
            label="Language"
            options={languageOptions}
            value={language}
            onValueChange={setLanguage}
          />
        </label>
        <p className="text-sm font-semibold text-[var(--muted)] sm:col-span-2 lg:col-span-1 lg:pb-3">
          {filteredSets.length.toLocaleString()} / {sets.length.toLocaleString()} sets
        </p>
      </div>

      {filteredSets.length > 0 ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSets.map((set) => (
            <Link
              className="group flex min-h-36 flex-col justify-between rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5 transition duration-200 hover:-translate-y-1 hover:border-[var(--secondary)]"
              href={`/sets/${encodeURIComponent(set.id)}`}
              key={set.id}
              prefetch={false}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
                    {set.languageCode === "ja" ? "Japanese" : "English"} · {set.series}
                  </p>
                  <h2 className="mt-2 text-xl font-bold">{set.name}</h2>
                </div>
                {set.images?.symbol ? (
                  <span className="relative size-10 shrink-0">
                    <Image
                      src={set.images.symbol}
                      alt=""
                      fill
                      sizes="40px"
                      unoptimized
                      className="object-contain"
                    />
                  </span>
                ) : null}
              </div>

              <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
                <span>{set.total.toLocaleString()} cards</span>
                <span>{set.releaseDate}</span>
                {currentCollectionProgress ? (
                  <span className="font-semibold text-[var(--secondary)]">
                    {(currentCollectionProgress[set.id] ?? 0).toLocaleString()} / {set.total.toLocaleString()} owned
                  </span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-12 text-center">
          <h2 className="text-xl font-bold">No sets found</h2>
          <p className="mt-2 text-[var(--muted)]">
            Try a different set name, language, series, or year.
          </p>
        </div>
      )}
    </section>
  );
}
