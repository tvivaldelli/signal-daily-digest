---
name: design-iterator
description: Iteratively refine and improve UI components through systematic design iterations. Takes screenshots, identifies improvements, implements changes, and repeats N times to progressively enhance any visual element. Use when asked to iterate on designs, do multiple design passes, refine UI components, or polish landing pages, hero sections, feature sections, or any visual element through repeated improvement cycles.
---

# Design Iterator

Systematically refine web components through iterative visual analysis and improvement cycles.

## Core Loop

For each iteration:

1. **Screenshot** — Capture current state
2. **Analyze** — Identify 3-5 specific improvements
3. **Implement** — Make targeted code changes
4. **Document** — Record what changed and why
5. **Repeat** — Continue for N iterations

## Starting a Cycle

1. Confirm target component/file path
2. Confirm iteration count (default: 10)
3. Optionally confirm competitor sites to research
4. Take initial screenshot as baseline
5. Begin iterations

## Iteration Output Format

```
## Iteration N/Total

**Current State Analysis:**
- [What's working well]
- [What could be improved]

**Changes This Iteration:**
1. [Specific change 1]
2. [Specific change 2]
3. [Specific change 3]

**Implementation:**
[Make the code changes]

**Screenshot:** [Take new screenshot]

---
```

## Design Principles

### Visual Hierarchy
- Headline sizing and weight progression
- Color contrast and emphasis
- Whitespace and breathing room
- Section separation and groupings

### Modern Patterns
- Gradient backgrounds and subtle patterns
- Micro-interactions and hover states
- Badge and tag styling
- Icon treatments (size, color, backgrounds)
- Border radius consistency

### Typography
- Font pairing (serif headlines, sans-serif body)
- Line height and letter spacing
- Text color variations (slate-900, slate-600, slate-400)
- Italic emphasis for key phrases

### Layout
- Hero card patterns (featured item larger)
- Asymmetric grids for visual interest
- Alternating patterns for rhythm
- Proper responsive breakpoints

### Polish Details
- Shadow depth and color (blue shadows for blue buttons)
- Subtle animations (pulses, transitions)
- Social proof badges and trust indicators
- Numbered or labeled items

## Competitor Research

When asked to research competitors, navigate to 2-3 sites, screenshot relevant sections, extract techniques, and apply insights in subsequent iterations.

**Design references:**
- **Stripe** — Clean gradients, depth, premium feel
- **Linear** — Dark themes, minimal, focused
- **Vercel** — Typography-forward, confident whitespace
- **Notion** — Friendly, approachable, illustration-forward
- **Mixpanel** — Data visualization, clear value props
- **Wistia** — Conversational copy, question-style headlines

## Frontend Aesthetics Guidelines

Avoid generic "AI slop" aesthetics. Make distinctive frontends that surprise and delight:

**Typography** — Choose beautiful, unique fonts. Avoid Arial, Inter, Roboto, system fonts. Make distinctive choices.

**Color & Theme** — Commit to a cohesive aesthetic. Use CSS variables. Dominant colors with sharp accents beat timid palettes. Draw from IDE themes and cultural aesthetics.

**Motion** — Prioritize high-impact moments: one well-orchestrated page load with staggered reveals creates more delight than scattered micro-interactions. Use CSS-only solutions when possible.

**Backgrounds** — Create atmosphere and depth. Layer gradients, use geometric patterns, add contextual effects. Avoid solid colors.

**Avoid:**
- Overused font families (Inter, Roboto, Space Grotesk)
- Clichéd purple gradients on white
- Predictable layouts and patterns
- Cookie-cutter design lacking character

## Guidelines

- Make 3-5 meaningful changes per iteration, not more
- Each iteration should be noticeably different but cohesive
- Don't undo good changes from previous iterations
- Early iterations: structure. Later iterations: polish
- Preserve existing functionality
- Maintain accessibility (contrast ratios, semantic HTML)
- Keep solutions simple and focused — don't over-engineer
