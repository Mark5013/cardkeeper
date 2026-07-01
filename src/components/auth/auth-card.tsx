export function AuthCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="auth-card">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">{eyebrow}</p>
      <h1 className="mt-3 text-3xl font-bold">{title}</h1>
      <p className="mt-3 leading-7 text-[var(--muted)]">{description}</p>
      <div className="mt-7">{children}</div>
    </section>
  );
}
