import Button from "@component/Button";

export default function ServerErrorPage() {
  setTitle("Something went wrong");

  return (
    <main class="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <p class="text-sm font-medium text-muted-foreground">500</p>
      <h1 class="text-3xl font-bold">Something went wrong</h1>
      <p class="max-w-md text-muted-foreground">
        An unexpected error occurred while loading this page. Try reloading, or come back later.
      </p>
      <Button label="Back to home" href="/" />
    </main>
  );
}
