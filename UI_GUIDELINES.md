# UI Guidelines

This document is the canonical visual and interaction style guide for PuzzlePKM UI work.

Scope:
- Applies to all UI surfaces (desktop wrapper, companion web shell, and any future UI clients).
- Is feature-agnostic: it defines how UI elements should look and behave, not where specific product features live.

Non-goals:
- No feature naming requirements.
- No route layout mandates.
- No screen-specific wiring instructions.

If any UI styling or behavior guideline conflicts with another doc, this file is canonical for visual rules.

## 1) Design Intent

- Desktop-first, dark, compact, and content-forward.
- Quiet chrome: low-noise containers and controls around high-legibility content.
- Clear hierarchy: title > body > metadata > tertiary utility text.
- Strong but restrained selection states.
- Consistent interaction cues across all components.

## 2) Global Principles

- Content-first: prioritize readability over decoration.
- Predictability: repeated visual grammar for repeated UI patterns.
- Subtle structure: use separators and contrast steps, not heavy shadows.
- State clarity: hover, active, focus, selected, disabled are always distinguishable.
- Density discipline: compact spacing with stable rhythm.
- Single accent strategy: one warm accent family for selected/emphasis states.

## 3) Token System (Canonical)

All UI styles must consume semantic tokens from one source of truth. Avoid direct hard-coded colors, spacing, or radii in feature components.

### 3.1 Color Roles

- `bg.app`: darkest global app background.
- `bg.surface.0`: primary panel surface.
- `bg.surface.1`: secondary/raised panel surface.
- `bg.surface.2`: controls/input resting background.
- `bg.hover`: hover overlay/tint.
- `bg.active`: pressed/active overlay/tint.
- `bg.selected`: persistent selected state fill.
- `border.subtle`: default boundaries/dividers.
- `border.strong`: emphasized boundaries/focus containers.
- `text.primary`: primary readable text.
- `text.secondary`: metadata and supporting text.
- `text.tertiary`: placeholders and low-priority labels.
- `text.inverse`: text on strong/accent backgrounds.
- `accent.primary`: warm highlight color.
- `accent.primary.hover`: stronger accent on hover.
- `accent.primary.soft`: translucent accent surface.
- `state.success`, `state.warning`, `state.error`, `state.info`.
- `focus.ring`: keyboard focus indicator.

### 3.2 Contrast Requirements

- Primary body text must meet WCAG AA contrast for normal text.
- Metadata text should remain legible without zoom.
- Selected text/background combinations must pass AA.
- Focus indicators must be visible independent of color perception.

### 3.3 Typography Roles

Use one sans family across application UI.

- `type.display`: large contextual titles (rare).
- `type.h1`: top-level pane heading.
- `type.h2`: section heading.
- `type.body.strong`: row titles and emphasized labels.
- `type.body`: default text.
- `type.caption`: metadata and timestamps.
- `type.micro`: tertiary utility labels only.

Typography rules:
- Prefer weight and color shifts over large size jumps.
- Keep headings tighter line-height than body text.
- Truncate long one-line labels with ellipsis.
- Use monospaced text only for code-like identifiers.

### 3.4 Spacing Scale

Base rhythm is 4px.

- `space.1`: 4px
- `space.2`: 8px
- `space.3`: 12px
- `space.4`: 16px
- `space.5`: 20px
- `space.6`: 24px
- `space.8`: 32px

Spacing rules:
- Use tokenized spacing only.
- Reuse vertical rhythm patterns for list rows and section blocks.
- Align icon centers and text baselines consistently.

### 3.5 Radius Scale

- `radius.sm`: 6px
- `radius.md`: 10px
- `radius.lg`: 14px
- `radius.xl`: 18px+

Radius rules:
- Larger radius for outer containers.
- Smaller radius for nested controls.
- Keep same-size controls on the same radius tier.

### 3.6 Border and Elevation

- Default border: 1px subtle contrast.
- Prefer borders/dividers over heavy drop shadows.
- Use elevated shadows only for floating overlays.
- Avoid stacking multiple visible borders in nested containers.

### 3.7 Motion

- Micro-interactions: 120-180ms.
- Small panel/overlay transitions: 200-260ms.
- Easing: smooth ease-out for enter, ease-in for exit.
- Animate opacity and transform when possible.
- Respect reduced-motion user preferences.

## 4) Surface Architecture

Define consistent depth levels:
- Level 0: app backdrop.
- Level 1: major panes.
- Level 2: controls/inputs and nested blocks.
- Level 3: overlays (menus, popovers, dialogs).

Rules:
- Each adjacent level should have perceptible contrast separation.
- Sticky bars/headers require opaque backdrop + divider line.
- Scrollable regions must preserve inner padding and readability.

## 5) Universal Interaction States

Every interactive element must define all applicable states:
- Rest
- Hover
- Active/Pressed
- Focus-visible
- Selected (if selectable)
- Disabled

State behavior:
- Hover: subtle emphasis increase.
- Active: tactile pressed feedback.
- Focus-visible: explicit ring/outline, never removed globally.
- Selected: persistent and visually distinct from hover.
- Disabled: reduced contrast, no hover affordances.

## 6) Iconography

- One icon family and consistent stroke philosophy per surface.
- Standard icon sizes: 14, 16, 18, 20.
- Decorative icons use secondary text color by default.
- Action icons increase contrast on hover/focus.
- Do not mix unrelated icon styles in the same control group.

## 7) Generic Component Guidelines

### 7.1 Buttons

Variants:
- `ghost`: low-chrome, context utility action.
- `subtle`: low-emphasis filled action.
- `primary`: highest-priority local action.
- `danger`: destructive action.

Rules:
- Keep consistent vertical height per size tier.
- Icon-only buttons need visible shape on hover/focus.
- Primary variant should be visually unique within local context.

### 7.2 Segmented Controls

- Shared capsule container with equal-height options.
- Active option uses stronger fill and contrast.
- Option spacing and hit area must be consistent.

### 7.3 Inputs and Search Fields

- Rounded input shell, subtle border, dark filled interior.
- Placeholder uses tertiary text color.
- Focus ring + border emphasis on keyboard focus.
- Prefix/suffix icons must not compress text area.

### 7.4 List Rows

Anatomy:
- Optional leading icon
- Primary label
- Secondary metadata
- Optional trailing affordance

Rules:
- Consistent row height within a list.
- Use separators between rows unless card style is explicit.
- Selected row uses accent-derived fill and high-contrast text.
- Hover state should not overpower selected state.

### 7.5 Hierarchical Rows

- Fixed indentation step for depth.
- Expand/collapse affordance alignment is stable.
- Parent/child distinction via weight/opacity, not random spacing shifts.

### 7.6 Chips/Tags

- Compact rounded tokens.
- Uniform chip height and horizontal padding.
- Distinct selected/unselected visual states.
- Text should remain legible in dense clusters.

### 7.7 Section Headers

- Compact heading with optional count/meta text.
- Increased spacing above section header vs below.
- Sticky behavior allowed in long scrollers with opaque backdrop.

### 7.8 Toolbars

- Single horizontal row when possible.
- Consistent control sizing and spacing.
- Overflow low-priority actions into menu in constrained widths.

### 7.9 Menus, Popovers, and Dialogs

- Elevated surface level with subtle border/shadow.
- Match application density and typography scales.
- Keyboard navigation and focus management required.
- Escape and outside-click behavior must be consistent by component type.

### 7.10 Empty and Loading States

- Keep messaging concise and neutral.
- Prioritize clarity over illustration-heavy placeholders.
- Loading placeholders should preserve final layout dimensions.

## 8) Content Styling Rules

- Primary content uses `text.primary` and body/body-strong type roles.
- Metadata uses `text.secondary` and caption role.
- Utility text uses `text.tertiary` sparingly.
- Links use accent color with explicit hover/focus treatment.
- Long-form reading columns should maintain comfortable max line length.

## 9) Responsive and Adaptive Behavior

- Baseline is desktop-density layout.
- At reduced widths: collapse non-critical chrome before reducing text legibility.
- Maintain control hit areas even at compact density.
- Preserve keyboard navigation behavior across breakpoints.
- Avoid horizontal overflow for text and controls whenever possible.

## 10) Accessibility Baseline

- Full keyboard support for all interactive elements.
- Visible focus indicator for keyboard navigation.
- Semantically correct labels for icon-only controls.
- Color should never be the only channel for state/meaning.
- Respect reduced motion and high-contrast OS settings.
- Ensure disabled and read-only states are distinguishable.

## 11) Agent Implementation Rules

These rules are mandatory for any agent implementing or modifying UI:

- Use role-based naming for style constructs (for example: `panel`, `row`, `meta`, `accent`), not feature/domain nouns.
- Do not define one-off colors/spacing/radii in individual screens.
- Add new tokens or shared variants centrally before local usage.
- For each new reusable UI primitive, define supported variants, sizes, and interaction states.
- Validate hover, selected, and focus-visible states before considering a change complete.
- Do not introduce a second competing visual grammar in a single surface.

## 12) Definition of Done for UI Work

A UI change is complete only if:

- It uses canonical semantic tokens.
- It supports all required interaction states.
- Typography hierarchy is clear at default density.
- Selection, hover, and focus are distinct and accessible.
- Responsive behavior preserves usability and legibility.
- No visual rules conflict with this document.

## 13) Implementation Starter Skeleton (Optional)

```css
:root {
  /* Color roles */
  --bg-app: ;
  --bg-surface-0: ;
  --bg-surface-1: ;
  --bg-surface-2: ;
  --bg-hover: ;
  --bg-active: ;
  --bg-selected: ;
  --border-subtle: ;
  --border-strong: ;
  --text-primary: ;
  --text-secondary: ;
  --text-tertiary: ;
  --text-inverse: ;
  --accent-primary: ;
  --accent-primary-hover: ;
  --accent-primary-soft: ;
  --focus-ring: ;

  /* Typography */
  --font-sans: ;
  --fs-display: ;
  --fs-h1: ;
  --fs-h2: ;
  --fs-body-strong: ;
  --fs-body: ;
  --fs-caption: ;
  --fs-micro: ;
  --lh-tight: ;
  --lh-normal: ;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 18px;

  /* Motion */
  --dur-fast: 140ms;
  --dur-base: 220ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
}
```

## 14) Documentation Relationship

- `README.md`: canonical product/domain behavior.
- `IMPLEMENTATION_DECISIONS.md`: canonical decision history (`DEC-*`).
- `AGENTS.md`: canonical workflow and required read order.
- `UI_GUIDELINES.md` (this file): canonical UI appearance and interaction rules.

