import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const product = z.object({
  name: z.string(),
  brand: z.string().optional(),
  query: z.string(),
  asin: z.string().optional(),
  badge: z.string(),
  summary: z.string(),
  // Shown as "Who it's for" (field name kept from the template for compatibility).
  renterNote: z.string(),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  specs: z.record(z.string()).optional(),
  image: z.object({ url: z.string().url(), width: z.number().optional(), height: z.number().optional() }).optional(),
  // Best Safe Score inputs: five criteria, 1-10 each (see src/lib/score.mjs).
  // fire is optional for products where it doesn't apply (car safes, lock boxes, accessories).
  scores: z
    .object({
      security: z.number().min(1).max(10),
      fire: z.number().min(1).max(10).optional(),
      access: z.number().min(1).max(10),
      capacity: z.number().min(1).max(10),
      value: z.number().min(1).max(10),
    })
    .optional(),
  scoreNote: z.string().optional(),
  // Amazon's listing title for the ASIN (the QA agent checks it matches the product).
  amazonTitle: z.string().optional(),
  // The ASIN was checked by hand against the exact model; the QA agent skips its title match.
  asinVerified: z.boolean().optional(),
  // Shorter name as Amazon lists the same model, used only to match the listing.
  matchName: z.string().optional(),
  // Extra official product photos from the Amazon Creators API (images.variants).
  gallery: z.array(z.object({ url: z.string().url(), width: z.number().optional(), height: z.number().optional() })).default([]),
  // What real owners report, summarized from the owner reviews and discussions the
  // research agent actually read (never Amazon review text or star ratings).
  owners: z
    .object({
      read: z.number().int().min(0),
      praise: z.array(z.string()).min(1).max(4),
      complaints: z.array(z.string()).min(1).max(4),
      // reviews: how many owner reviews that page holds (its review themes cover all of them)
      sources: z.array(z.object({ title: z.string(), url: z.string().url(), reviews: z.number().int().optional() })).min(1),
    })
    .optional(),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string().max(70),
    seoTitle: z.string().max(65).optional(),
    description: z.string().min(80).max(170),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    category: z.string(),
    keyword: z.string(),
    secondaryKeywords: z.array(z.string()).default([]),
    entities: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    articleType: z.enum(['roundup', 'review', 'comparison', 'how-to', 'guide']).default('guide'),
    funnel: z.enum(['tofu', 'mofu', 'bofu']).optional(),
    readingTime: z.number().optional(),
    tldr: z.array(z.string()).default([]),
    products: z.array(product).default([]),
    faqs: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    related: z.array(z.string()).default([]),
    author: z.string().default('editorial-team'),
    reviewedDate: z.coerce.date().optional(),
    // true when the post retells a real story from data/stories.json
    ownerStory: z.boolean().optional(),
    // planned number of products for this post (random per post)
    productCount: z.number().optional(),
    // how products are presented, chosen from the top search results
    productStyle: z.enum(['pros-cons', 'paragraph', 'specs']).default('pros-cons'),
    sources: z.array(z.object({ title: z.string(), url: z.string().url() })).default([]),
    draft: z.boolean().default(false),
    // Language versions: translated posts live in src/content/blog/<lang>/<localized-slug>.md
    // (id '<lang>/<slug>') and name the English post they localize.
    lang: z.enum(['en', 'de', 'es', 'nl']).default('en'),
    translationOf: z.string().optional(),
    heroImage: z.string().optional(),
    heroAlt: z.string().optional(),
    photoQuery: z.string().optional(),
    // Unsplash photos (agents/unsplash-images.mjs): one hero, up to two inline.
    photos: z
      .array(
        z.object({
          id: z.string(),
          url: z.string().url(),
          width: z.number().optional(),
          height: z.number().optional(),
          alt: z.string(),
          credit: z.string(),
          creditUrl: z.string().url(),
          unsplashUrl: z.string().url(),
          placement: z.enum(['hero', 'inline']),
          afterHeading: z.number().optional(),
        }),
      )
      .default([]),
  }),
});

export const collections = { blog };
