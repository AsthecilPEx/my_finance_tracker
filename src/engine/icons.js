// Icon names (lucide-react) used by the engine's data: categories, goals, insights, review items.
// The engine stays free of React; the renderer turns a name into an icon (components/Icon.jsx).
// Older saved data used emojis as icons; LEGACY maps each one (written as code points) to its icon name.

export const LEGACY = {
  '\u{1F3E0}': 'House', '\u{1F4A1}': 'Lightbulb', '\u{1F6D2}': 'ShoppingCart', '\u{1F686}': 'TrainFront', '\u{1F6E1}\u{FE0F}': 'Shield', '\u{1F6E1}': 'Shield',
  '\u{1F4AA}': 'Dumbbell', '\u{1F354}': 'Utensils', '\u{2615}': 'Coffee', '\u{1F6CD}\u{FE0F}': 'ShoppingBag', '\u{1F6CD}': 'ShoppingBag', '\u{1F4FA}': 'Tv',
  '\u{1F39F}\u{FE0F}': 'Ticket', '\u{1F39F}': 'Ticket', '\u{1F487}': 'Scissors', '\u{2708}\u{FE0F}': 'Plane', '\u{2708}': 'Plane', '\u{1F381}': 'Gift', '\u{1F4DA}': 'BookOpen',
  '\u{1F4B3}': 'CreditCard', '\u{1F3E6}': 'Landmark', '\u{1F4B7}': 'Banknote', '\u{1F4E6}': 'Package', '\u{1F501}': 'Repeat', '\u{1F91D}': 'Handshake',
  '\u{1F4BC}': 'Briefcase', '\u{1F4B0}': 'Wallet', '\u{1F3AF}': 'Target', '\u{1F6DF}': 'LifeBuoy', '\u{1F3D6}\u{FE0F}': 'Umbrella', '\u{1F3D6}': 'Umbrella',
  '\u{1F437}': 'PiggyBank', '\u{1F697}': 'Car', '\u{1F3E1}': 'House', '\u{1F476}': 'Baby', '\u{1F436}': 'Dog', '\u{1F3B5}': 'Music', '\u{1F3AE}': 'Gamepad2',
  '\u{1F455}': 'Shirt', '\u{1F48A}': 'Pill', '\u{2764}\u{FE0F}': 'Heart', '\u{2B50}': 'Star', '\u{1F9FE}': 'Receipt', '\u{1F9FA}': 'ShoppingBasket',
};

/** Icons offered when you pick one for a savings goal. */
export const GOAL_ICONS = ['Target', 'LifeBuoy', 'Umbrella', 'Plane', 'House', 'Car', 'Gift', 'PiggyBank', 'BookOpen', 'Heart', 'Baby', 'Star'];

/** A saved icon value as an icon name: names pass through, old emojis are translated. */
export function iconName(value, fallback = 'Tag') {
  const v = String(value || '').trim();
  if (!v) return fallback;
  if (/^[A-Z][A-Za-z0-9]+$/.test(v)) return v;
  return LEGACY[v] || LEGACY[v.replace(/️/g, '')] || fallback;
}
