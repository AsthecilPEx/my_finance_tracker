# CLAUDE.md

## UI, Iconography & Motion Rules
- STRICTLY NO EMOJIS anywhere in the UI, buttons, headers, badges, notifications, or empty states.
- Use `lucide-react` exclusively for all standard static UI icons. Never write raw inline `<svg>` paths for standard icons.
- Maintain consistent icon styling: `strokeWidth={1.75}` by default, `w-4 h-4` inside buttons/inline text, `w-5 h-5` in navigation, and `w-8 h-8` in empty states.
- Never use `.gif` files for UI feedback or animations.
- For interactive micro-animations (bells, checkmarks, toggles, primary CTAs), install and use components from `lucide-animated` (`npx shadcn@latest add "https://lucide-animated.com/r/<icon-name>.json"`), or wrap `lucide-react` icons with `motion/react`.
- For standard loading spinners, use `Loader2` from `lucide-react` with Tailwind's `animate-spin` class.
