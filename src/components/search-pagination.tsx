import Link from "next/link";

function paginationItems(currentPage: number, totalPages: number) {
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const visible = [...pages]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);
  const items: Array<number | "ellipsis"> = [];

  visible.forEach((page, index) => {
    if (index > 0 && page - visible[index - 1] > 1) items.push("ellipsis");
    items.push(page);
  });

  return items;
}

function searchHref(query: string, page: number) {
  return { pathname: "/search", query: { query, ...(page > 1 ? { page: String(page) } : {}) } };
}

export function SearchPagination({
  query,
  currentPage,
  totalPages,
}: {
  query: string;
  currentPage: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav className="mt-10 flex flex-wrap items-center justify-center gap-2" aria-label="Search result pages">
      {currentPage > 1 ? (
        <Link className="pagination-link" href={searchHref(query, currentPage - 1)} rel="prev">
          ← Previous
        </Link>
      ) : (
        <span className="pagination-link opacity-40" aria-disabled="true">← Previous</span>
      )}

      {paginationItems(currentPage, totalPages).map((item, index) =>
        item === "ellipsis" ? (
          <span className="px-2 text-[var(--muted)]" key={`ellipsis-${index}`} aria-hidden="true">…</span>
        ) : (
          <Link
            className="pagination-link min-w-10 justify-center"
            data-active={item === currentPage}
            href={searchHref(query, item)}
            aria-current={item === currentPage ? "page" : undefined}
            key={item}
          >
            {item}
          </Link>
        ),
      )}

      {currentPage < totalPages ? (
        <Link className="pagination-link" href={searchHref(query, currentPage + 1)} rel="next">
          Next →
        </Link>
      ) : (
        <span className="pagination-link opacity-40" aria-disabled="true">Next →</span>
      )}
    </nav>
  );
}
