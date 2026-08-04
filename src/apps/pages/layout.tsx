export default async function RootLayout({ children }: { children?: unknown }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>DryCMS</title>
      </head>
      <body>
        <nav class="flex gap-4 border-b border-gray-200 px-4 py-3 font-sans text-sm">
          <a class="text-blue-600 hover:underline" href="/">
            Home
          </a>
          <a class="text-blue-600 hover:underline" href="/users">
            Users
          </a>
          <a class="text-blue-600 hover:underline" href="/roles">
            Roles
          </a>
        </nav>
        <div class="p-4 font-sans">{children as never}</div>
      </body>
    </html>
  );
}
