import {
  Atom,
  BookOpen,
  BookUser,
  Brain,
  Briefcase,
  Clapperboard,
  Cpu,
  Cross,
  Dumbbell,
  Feather,
  Flower2,
  Globe,
  GraduationCap,
  Heart,
  Landmark,
  Baby,
  Music,
  Palette,
  PiggyBank,
  Rocket,
  ScrollText,
  Shapes,
  Sparkles,
  TrendingUp,
  Users,
  Utensils,
  Wand2,
  Box,
  MessagesSquare,
  Pencil,
  Search,
  type LucideIcon,
} from "lucide-react";

/**
 * Line icons for subject categories (Lucide, ISC licence: see the LICENSE in
 * node_modules/lucide-react). Matched on the list slug, first rule wins, so
 * specific subjects sit above broad ones. Anything unmatched gets an open
 * book, which keeps a row of pills visually even.
 */
const RULES: Array<[RegExp, LucideIcon]> = [
  // Before the fiction rule, which would otherwise match inside "nonfiction".
  [/^(best-)?non-?fiction/, Box],
  [/christian|religion|bible|theolog|faith|buddhis|islam|juda|hindu/, Cross],
  [/spiritual|mindful|meditat/, Flower2],
  [/biograph|memoir/, BookUser],
  [/fantasy|magic/, Wand2],
  [/science-fiction|sci-fi|space/, Rocket],
  [/mystery|crime|thriller|suspense|detective/, Search],
  [/romance|love|relationship|marriage|dating/, Heart],
  [/business|entrepreneur|management|leadership|marketing|sales|startup|career/, Briefcase],
  [/invest|financ|money|econom|wealth/, PiggyBank],
  [/politic|government|law|democra/, Landmark],
  [/histor|war|ancient/, ScrollText],
  [/psycholog|mind|brain|neuro/, Brain],
  [/philosoph|ethic|stoic/, MessagesSquare],
  [/personal-development|self-|habit|product|motivat/, TrendingUp],
  [/social|sociolog|anthropolog/, Users],
  [/science|physic|chemi|biolog|astronom|math|nature|environment/, Atom],
  [/technolog|program|computer|software|machine-learning|ai-|artificial|data/, Cpu],
  [/health|fitness|nutrition|medic|wellness|sport/, Dumbbell],
  [/child|kids|baby|parenting/, Baby],
  [/young-adult|teen|education|school|student|study/, GraduationCap],
  [/art|paint|photograph|architect/, Palette],
  [/design|fashion|craft/, Shapes],
  [/poet|poem|verse/, Feather],
  [/writing|writer|journalism|essay/, Pencil],
  [/music/, Music],
  [/film|cinema|movie|television|theat/, Clapperboard],
  [/food|cook|recipe|chef/, Utensils],
  [/travel|geograph|countr|culture/, Globe],
  [/fiction|novel|story|literature|classic|horror|short-stor/, Sparkles],
];

export function categoryIconFor(slug: string): LucideIcon {
  const s = (slug || "").toLowerCase();
  for (const [re, Icon] of RULES) if (re.test(s)) return Icon;
  return BookOpen;
}

export function CategoryIcon({
  slug,
  size = 16,
  className = "",
}: {
  slug: string;
  size?: number;
  className?: string;
}) {
  const Icon = categoryIconFor(slug);
  return <Icon width={size} height={size} strokeWidth={1.75} aria-hidden="true" className={`shrink-0 ${className}`} />;
}
