import ThemeToggle from "@component/ThemeToggle";

export default async function Layout({ children }: { children?: unknown }) {
  const { rows } = await dry().collection("menu").list({
    where: [{ field: "name", op: "eq", value: "Main" }],
    pageSize: 1,
    select: { name: true, refs: true },
  });
  const menu = rows[0];

  return (
    <div class="flex min-h-dvh flex-col bg-background text-foreground">
      <header class="border-b border-border">
        <div class="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-6">
          <a href="/" class="font-semibold tracking-tight">drycms</a>
          <div class="flex items-center gap-2">
            <nav aria-label={menu?.name ?? "Main navigation"}>
              <ul class="flex items-center gap-1">
                {menu?.refs?.map((item) => (
                  <li key={item.href}>
                    <a href={item.href} class="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div class="flex flex-1 flex-col">{children as never}</div>
    </div>
  );
}
