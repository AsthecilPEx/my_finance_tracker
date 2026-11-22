# CLAUDE.md

## UI, Iconography & Motion Rules
- STRICTLY NO EMOJIS anywhere in the UI, buttons, headers, badges, notifications, or empty states.
- Use `lucide-react` exclusively for all standard static UI icons. Never write raw inline `<svg>` paths for standard icons.
- Maintain consistent icon styling: `strokeWidth={1.75}` by default, `w-4 h-4` inside buttons/inline text, `w-5 h-5` in navigation, and `w-8 h-8` in empty states.
- Never use `.gif` files for UI feedback or animations.
- For interactive micro-animations (bells, checkmarks, toggles, primary CTAs), install and use components from `lucide-animated` (`npx shadcn@latest add "https://lucide-animated.com/r/<icon-name>.json"`), or wrap `lucide-react` icons with `motion/react`.
- For standard loading spinners, use `Loader2` from `lucide-react` with Tailwind's `animate-spin` class.

## Design
- For any UI work (new screens, components, layout, colours, typography, icons), load the `apple-design` skill (`.claude/skills/apple-design`) first and follow its guidance.
- Before finishing a UI change, run an apple-design review of the changed screens and fix anything it flags as a guideline violation.
- Where the skill and the UI rules above disagree, the rules above win (no emojis; `lucide-react` icons and sizes).
- Pulse is an Electron + React app for Windows: apply the skill's guidance to web/desktop UI, not SwiftUI.
