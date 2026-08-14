export default async function ServerError() {
  return (
    <main class="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6 py-16">
      <p class="text-sm font-semibold uppercase tracking-widest text-slate-500">500</p>
      <h1 class="text-4xl font-bold text-slate-950 dark:text-white">Something went wrong</h1>
      <p class="text-slate-600 dark:text-slate-300">Please try again in a moment.</p>
    </main>
  );
}
