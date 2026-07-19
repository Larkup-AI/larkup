---
name: ui-development-guide
description: Guidelines on using Shadcn UI, TailwindCSS v4, Framer Motion, and creating rich, dynamic, premium-looking interfaces as expected in Larkup.
tags: ui, frontend, css, design
---

# UI Development Guide

## Design Aesthetics

Larkup aims for a premium, open-source aesthetic. **Visual excellence is a core requirement**, not an afterthought.

1. **Rich Aesthetics**: The user should be "wowed" at first glance. We employ modern web design best practices:
   - **No shadow, small rounding, classy modern minimal UI targeted for tech users.**
   - Vibrant but curated color palettes.
   - High-quality dark modes.
   - Glassmorphism effects where appropriate.
2. **Typography**: We use modern fonts (e.g., Inter, Geist) and strictly avoid browser defaults. Ensure proper hierarchy.
3. **Animations and Interactivity**:
   - Interfaces must feel "alive."
   - Implement smooth hover states and interactive micro-animations using **Framer Motion**.
   - Ensure all dialogs, tabs, and panels transition cleanly without layout jitter.

## Technology Stack

- **React & Next.js (App Router)**: The core of `apps/web`.
- **Tailwind CSS v4**: Utility-first CSS is our primary styling method. Avoid plain `.css` files unless overriding library styles in `globals.css`.
- **Shadcn UI**: For foundational accessible components (`Button`, `Dialog`, `Input`, etc.). Always check if a Shadcn component exists before building a custom primitive.
- **Framer Motion**: For all complex layout animations, spring physics, and enter/exit animations.

## Workflow & Best Practices

1. **Component Modularity**: Keep components in `apps/web/components/`. If a component is highly reusable across different domains, put it in a generic `ui/` subdirectory.
2. **Icons**: Use `lucide-react` for standard UI iconography.
3. **Responsive Design**: Ensure mobile-first utility classes (`sm:`, `md:`, `lg:`) are used correctly. 
4. **Theming**: We use `next-themes` for dark mode. Always test components in both light and dark modes to ensure contrast and readability.

## Data Visualization & Charts

When implementing charts (e.g., using Recharts):
1. **Remove Focus Rings**: Charts often have default SVG focus outlines that detract from a premium feel. Always remove them using wrapper classes like `[&_.recharts-surface]:outline-none [&_.recharts-wrapper]:outline-none` and by removing outline from `activeDot` or `activeBar`.
2. **Elegant Empty States**: Never show a completely blank canvas when data is empty. Instead, render "dummy" data with a low opacity and grayscale filter (e.g., `opacity: 0.15, filter: grayscale(100%)`) and place a classy, minimal overlay over the chart area. The overlay should have no shadow, no border, and a whiter background (e.g., `bg-white/90` or `bg-background/90`) to maintain a clean layout.
