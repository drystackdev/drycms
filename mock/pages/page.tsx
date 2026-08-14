export default function HomePage() {
  setTitle("Home");

  return (
    <main class="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
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
