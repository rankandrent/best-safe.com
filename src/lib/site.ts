import siteConfig from '../../site.config.json';

export const SITE = siteConfig;

export type Category = (typeof siteConfig.categories)[number];
export type Author = (typeof siteConfig.authors)[number];

export const CATEGORY_ICON: Record<string, string> = {
  'handgun-safes': 'pistol',
  'gun-safes': 'gunsafe',
  'fireproof-safes': 'flame',
  'home-safes': 'house',
  'vehicle-safes': 'car',
  'wall-floor-safes': 'wall',
  'lock-boxes': 'padlock',
  'safe-accessories': 'ammo',
  'safe-guides': 'book',
};

export function getCategory(slug: string): Category | undefined {
  return siteConfig.categories.find((c) => c.slug === slug);
}

export function categoryName(slug: string): string {
  return getCategory(slug)?.name ?? slug;
}

export function getAuthor(slug: string): Author {
  return siteConfig.authors.find((a) => a.slug === slug) ?? siteConfig.authors[0];
}

export function initials(name: string): string {
  return name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join('') || 'BS';
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function absUrl(path: string): string {
  return new URL(path, siteConfig.url).toString();
}

/** schema.org node for an author (Person when a real person is configured). */
export function authorSchema(a: Author) {
  return {
    '@type': a.type === 'Person' ? 'Person' : 'Organization',
    name: a.name,
    url: absUrl(`/authors/${a.slug}/`),
    ...(a.image ? { image: absUrl(a.image) } : {}),
    ...(a.sameAs?.length ? { sameAs: a.sameAs } : {}),
    ...(a.type === 'Person' ? { jobTitle: a.role, knowsAbout: a.expertise } : { knowsAbout: a.expertise }),
  };
}

export function organizationSchema() {
  return {
    '@type': 'Organization',
    '@id': absUrl('/#organization'),
    name: siteConfig.name,
    url: siteConfig.url,
    logo: { '@type': 'ImageObject', url: absUrl('/logo-512.png'), width: 512, height: 512 },
    email: siteConfig.contactEmail,
    foundingDate: siteConfig.organization.foundingDate,
    publishingPrinciples: absUrl(siteConfig.organization.editorialPolicyUrl),
    ...(siteConfig.organization.sameAs.length ? { sameAs: siteConfig.organization.sameAs } : {}),
  };
}

/** Site-wide WebSite node: brand name, alternate names and on-site search. */
export function websiteSchema() {
  return {
    '@type': 'WebSite',
    '@id': absUrl('/#website'),
    name: siteConfig.name,
    alternateName: ['BestSafe', 'Best-Safe.com', siteConfig.domain],
    url: siteConfig.url,
    description: siteConfig.description,
    publisher: { '@id': absUrl('/#organization') },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: absUrl('/search/') + '?q={search_term_string}' },
      'query-input': 'required name=search_term_string',
    },
  };
}
