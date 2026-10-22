import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleView } from "@/components/cms/article-view";
import { getPost, listPosts } from "@/lib/cms";

export const revalidate = 300;

// Pre-render what exists at build time; articles published later render on
// first visit (dynamicParams stays on).
export async function generateStaticParams() {
  return (await listPosts("guide")).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata(props: PageProps<"/knowledge-hub/[slug]">): Promise<Metadata> {
  const found = await getPost("guide", (await props.params).slug);
  if (!found) return {};
  const { post } = found;
  const path = `/knowledge-hub/${post.slug}`;
  const description = post.seo_description || post.excerpt;
  return {
    title: post.seo_title || post.title,
    description,
    keywords: post.tags ?? undefined,
    alternates: { canonical: path },
    openGraph: { url: path, type: "article", title: post.seo_title || post.title, description, ...(post.cover_image ? { images: [post.cover_image] } : {}) },
  };
}

export default async function GuidePage(props: PageProps<"/knowledge-hub/[slug]">) {
  const found = await getPost("guide", (await props.params).slug);
  if (!found) notFound();
  const all = await listPosts("guide");
  const siblings = all.filter((p) => p.category === found.post.category);
  return <ArticleView post={found.post} related={found.related} siblings={siblings} />;
}
