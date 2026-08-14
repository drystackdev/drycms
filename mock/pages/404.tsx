export default async function NotFound() {
  return (
    <main class="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6 py-16">
      <p class="text-sm font-semibold uppercase tracking-widest text-slate-500">404</p>
      <h1 class="text-4xl font-bold text-slate-950 dark:text-white">Page not found</h1>
      <a class="text-blue-600 hover:underline dark:text-blue-400" href="/">Return home</a>
    </main>
  );
}
