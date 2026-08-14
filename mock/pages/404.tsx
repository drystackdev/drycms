import Button from "@component/Button";

export default function NotFoundPage() {
  setTitle("Page not found");

  return (
    <main class="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <p class="text-sm font-medium text-muted-foreground">404</p>
      <h1 class="text-3xl font-bold">Page not found</h1>
      <p class="max-w-md text-muted-foreground">
        The page you're looking for doesn't exist or may have been moved.
      </p>
      <Button label="Back to home" href="/" />
    </main>
  );
}
