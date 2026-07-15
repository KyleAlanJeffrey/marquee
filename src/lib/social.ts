import type Ionicons from '@expo/vector-icons/Ionicons';

type IconName = keyof typeof Ionicons.glyphMap;

export type SocialLink = {
  id: string;
  label: string;
  icon: IconName;
  color: string;
  url: string;
};

/**
 * Deep links into each platform's search for a specific show (artist + venue),
 * so a tap drops you into the live conversation about that date. X and TikTok
 * have no open search API, so we link out rather than invent posts.
 */
export function socialLinks(artist: string, venue?: string | null): SocialLink[] {
  const q = [artist, venue].filter(Boolean).join(' ');
  const e = encodeURIComponent(q);
  return [
    { id: 'x', label: 'X / Twitter', icon: 'logo-twitter', color: '#e7e9ea', url: `https://x.com/search?q=${e}&f=live` },
    { id: 'tiktok', label: 'TikTok', icon: 'logo-tiktok', color: '#ff2d55', url: `https://www.tiktok.com/search?q=${e}` },
    { id: 'reddit', label: 'Reddit', icon: 'logo-reddit', color: '#ff4500', url: `https://www.reddit.com/search/?q=${e}&sort=new` },
    { id: 'youtube', label: 'YouTube', icon: 'logo-youtube', color: '#ff0000', url: `https://www.youtube.com/results?search_query=${e}` },
  ];
}
