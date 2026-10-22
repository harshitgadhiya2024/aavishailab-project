import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleView } from "@/components/cms/article-view";
import { getPost, listPosts } from "@/lib/cms";

export const revalidate = 300;

export async function generateStaticParams() {
  return (await listPosts("blog")).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata(props: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const found = await getPost("blog", (await props.params).slug);
  if (!found) return {};
  const { post } = found;
  const path = `/blog/${post.slug}`;
  const description = post.seo_description || post.excerpt;
  return {
    title: post.seo_title || post.title,
    description,
    keywords: post.tags ?? undefined,
    alternates: { canonical: path },
    openGraph: {
      url: path,
      type: "article",
      title: post.seo_title || post.title,
      description,
      publishedTime: post.published_at ?? undefined,
      modifiedTime: post.updated_at,
      ...(post.cover_image ? { images: [post.cover_image] } : {}),
    },
  };
}

export default async function BlogPostPage(props: PageProps<"/blog/[slug]">) {
  const found = await getPost("blog", (await props.params).slug);
  if (!found) notFound();
  // Same-category posts first, then the latest others, so there is always something to read next.
  const more = (await listPosts("blog")).filter((p) => p.slug !== found.post.slug && !found.related.some((r) => r.slug === p.slug));
  const related = [...found.related, ...more].slice(0, 3);
  return <ArticleView post={found.post} related={related} />;
}
