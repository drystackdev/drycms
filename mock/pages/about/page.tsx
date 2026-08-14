export default function AboutPage() {
  setTitle("About");

  return (
    <main class="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 px-6 py-16">
      <p class="text-sm font-medium text-muted-foreground">About</p>
      <h1 class="text-4xl font-bold tracking-tight sm:text-5xl">Built with drycms</h1>
      <p class="max-w-2xl text-lg leading-8 text-muted-foreground">
        This starter page is ready to become your story. Edit it from the Page Editor and shape it around your project.
      </p>
    </main>
  );
}
