# Isla 405D Interface System

## Design intent

The product should feel like a calm, well-run coastal residence rather than an enterprise back office. It must help a guest understand the approval process and help the owner act on the right operational item without obscuring safety gates.

## Principles

1. **Priority before volume.** Red risks and the next owner action appear before records, integrations, and technical details.
2. **Calm, not casual.** Warm sand, bay teal, restrained coral, generous spacing, and editorial headings create trust without making a compliance workflow feel bureaucratic.
3. **Truthful state.** Color is always paired with text. No state is communicated only by decoration.
4. **Progressive detail.** Guest pages lead with the next action. The owner dashboard leads with focus and deadlines. Technical systems follow daily work.
5. **Touch-safe and readable.** Controls are at least 44 pixels high, focus rings are visible, mobile layouts become one column, and reduced-motion preferences are respected.
6. **No hidden automation.** Copy, send, approval, and release actions remain explicit. The visual redesign does not weaken workflow or authorization gates.

## Visual tokens

- **Canvas:** warm sand `#F5F2E9`
- **Paper:** soft white `#FFFDF8`
- **Primary ink:** deep coastal green `#17302E`
- **Primary action:** bay teal `#176C68`
- **Accent:** sunset coral `#D96B48`
- **Display type:** Georgia-style editorial serif
- **Body type:** Avenir-style humanist sans serif with system fallbacks
- **Card radii:** 16 to 24 pixels
- **Spacing rhythm:** 4, 8, 12, 16, 20, 24, 32, 48, 64 pixels

## Information architecture

### Guest portal

- Hero and trust context
- Four-stage approval path
- Private-page lookup
- Home and booking details
- FAQ as disclosure sections
- Personal status page with primary action first, progress second, supporting context last

### Owner operations

- Sticky identity and save state
- Sticky section navigation
- Today's priorities and guardrail
- Prioritized work with the selected case
- Daily work areas: calendar, cleaning, payments, maintenance, calls, listing
- Technical areas: integrations, devices, operations tree

## Accessibility contract

- Keyboard skip links
- Visible `:focus-visible` treatment
- Text labels for every status color
- Minimum 44-pixel interactive targets
- Responsive layouts at 1320, 980, 820, 700, and 640 pixels as appropriate
- No essential motion and explicit reduced-motion handling
- Semantic headings, navigation landmarks, forms, and live-safe status text remain intact
