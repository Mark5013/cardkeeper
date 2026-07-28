"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { FieldSelect } from "@/components/ui/field-select";
import type { SealedCatalogSet } from "@/lib/catalog/sealed-data";

type LanguageFilter = "all" | "en" | "ja";

const languageOptions = [
  { value: "all", label: "All languages" },
  { value: "en", label: "English" },
  { value: "ja", label: "Japanese" },
] as const;

const date = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function setMatchesQuery(set: SealedCatalogSet, normalizedQuery: string) {
  if (!normalizedQuery) return true;

  const searchableText = normalizeSearchText(
    [
      set.name,
      set.releaseDate,
      set.languageCode,
      set.languageCode === "ja" ? "Japanese" : "English",
      "sealed",
    ]
      .filter(Boolean)
      .join(" "),
  );

  return normalizedQuery
    .split(" ")
    .every((token) => searchableText.includes(token));
}

function SealedSetCard({ set }: { set: SealedCatalogSet }) {
  return (
    <Link
      className="group flex min-h-36 flex-col justify-between rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5 transition duration-200 hover:-translate-y-1 hover:border-[var(--secondary)]"
      href={`/sealed/sets/${set.categoryId}/${set.groupId}`}
      prefetch={false}
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
          {set.languageCode === "ja" ? "Japanese" : "English"} · Sealed
          {set.isPresale ? " · Presale" : ""}
        </p>
        <h2 className="mt-2 text-xl font-bold">{set.name}</h2>
      </div>

      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
        <span>
          {set.productCount.toLocaleString()}{" "}
          {set.productCount === 1 ? "product" : "products"}
        </span>
        {set.releaseDate ? (
          <span>{date.format(new Date(`${set.releaseDate}T00:00:00Z`))}</span>
        ) : null}
      </div>
    </Link>
  );
}

export function SealedSetsBrowser({ sets }: { sets: SealedCatalogSet[] }) {
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState<LanguageFilter>("all");
  const normalizedQuery = normalizeSearchText(query);
  const filteredSets = useMemo(
    () =>
      sets.filter(
        (set) =>
          (language === "all" || set.languageCode === language) &&
          setMatchesQuery(set, normalizedQuery),
      ),
    [language, normalizedQuery, sets],
  );

  return (
    <section className="mt-10">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem] lg:grid-cols-[minmax(0,1fr)_12rem_auto] lg:items-end">
        <label className="block">
          <span className="auth-label">Find sealed sets</span>
          <input
            autoComplete="off"
            className="auth-input"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search set names, languages, or years"
            type="search"
            value={query}
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
          {filteredSets.length.toLocaleString()} /{" "}
          {sets.length.toLocaleString()} sets
        </p>
      </div>

      {filteredSets.length > 0 ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSets.map((set) => (
            <SealedSetCard
              key={`${set.categoryId}:${set.groupId}`}
              set={set}
            />
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-12 text-center">
          <h2 className="text-xl font-bold">No sealed sets found</h2>
          <p className="mt-2 text-[var(--muted)]">
            Try a different set name, language, or year.
          </p>
        </div>
      )}
    </section>
  );
}
