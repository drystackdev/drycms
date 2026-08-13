export default function HomePage() {
  setTitle("Home");

  return (
    <main class="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
      <p class="text-sm font-medium text-muted-foreground">Welcome</p>
      <h1 class="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
        Your drycms project starts here
      </h1>
      <p class="max-w-md text-muted-foreground">
        This is{" "}
        <code class="rounded bg-muted px-1.5 py-0.5 text-sm">
          pages/page.tsx
        </code>{" "}
        - edit it from the Page Editor to build your real homepage.
      </p>
    </main>
  );
}
