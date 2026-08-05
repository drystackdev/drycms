function formatDate(date: Date): string {
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default async function BlogDetailPage({ params }: { params: { slug: string } }) {
  const post = await dry().collection("blog").get(params.slug);
  const { rows: relatedPosts } = post
    ? await dry()
        .collection("blog")
        .list({ where: [{ field: "tag", op: "eq", value: post.tag }], sort: { field: "date", dir: "desc" }, pageSize: 4 })
    : { rows: [] };
  const related = relatedPosts.filter((p) => p.id !== post?.id).slice(0, 3);

  if (!post) {
    return (
      <div class="mx-auto max-w-5xl px-4 py-24 text-center">
        <h1 class="text-2xl font-bold text-slate-900">Không tìm thấy bài viết</h1>
        <p class="mt-2 text-sm text-slate-600">Bài viết này có thể đã bị gỡ hoặc đường dẫn không đúng.</p>
        <a href="/blogs" class="mt-6 inline-block text-sm font-medium text-red-900 hover:underline">
          ← Quay lại Blog
        </a>
      </div>
    );
  }

  return (
    <article class="mx-auto max-w-5xl px-4 py-16">
      <a href="/blogs" class="text-sm font-medium text-red-900 hover:underline">
        ← Quay lại Blog
      </a>

      <div class="mt-4">
        <span class="rounded-full bg-red-100 px-4 py-1 text-sm font-medium text-red-900">{post.tag}</span>
        <h1 class="mt-4 text-3xl font-bold text-slate-900 sm:text-4xl">{post.title}</h1>
        <p class="mt-2 text-sm text-slate-500">{formatDate(post.date)}</p>
      </div>

      <div class="mt-8 h-64 rounded-2xl bg-slate-200 sm:h-96" />

      <div class="mt-8 space-y-4 text-sm leading-relaxed text-slate-700 sm:text-base">
        {post.content.split("\n\n").map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>

      <div class="mt-12 flex items-center gap-4 rounded-2xl border border-slate-200 p-5">
        <div class="h-12 w-12 shrink-0 rounded-full bg-slate-200" />
        <div>
          <p class="text-sm font-semibold text-slate-900">Mai Anh Quyền</p>
          <p class="text-xs text-slate-500">Tiếp cận viên cộng đồng, chung tay phòng chống HIV/AIDS</p>
        </div>
        <a href="/about" class="ml-auto shrink-0 text-sm font-medium text-red-900 hover:underline">
          Xem thêm →
        </a>
      </div>

      <div class="mt-8 flex flex-col items-center gap-3 rounded-2xl bg-red-800 px-8 py-10 text-center text-white">
        <h2 class="text-xl font-bold">Bạn cần được tư vấn riêng tư?</h2>
        <a href="/contact" class="rounded-full bg-white px-6 py-3 text-sm font-semibold text-red-900 hover:bg-red-50">
          Liên hệ ngay
        </a>
      </div>

      {related.length > 0 ? (
        <div class="mt-12">
          <h2 class="text-lg font-bold text-slate-900">Bài viết liên quan</h2>
          <div class="mt-4 grid gap-6 sm:grid-cols-3">
            {related.map((relatedPost) => (
              <a
                key={relatedPost.slug}
                href={`/blogs/${relatedPost.slug}`}
                class="block overflow-hidden rounded-2xl border border-slate-200 hover:border-red-300"
              >
                <div class="h-32 bg-slate-200" />
                <div class="space-y-1 p-4">
                  <span class="text-xs font-semibold uppercase tracking-wide text-red-900">{relatedPost.tag}</span>
                  <h3 class="text-sm font-semibold text-slate-900">{relatedPost.title}</h3>
                  <p class="text-xs text-slate-500">{formatDate(relatedPost.date)}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
