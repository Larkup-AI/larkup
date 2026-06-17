import type { SVGProps } from "react"

export function BrewMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M6 11h16v6a8 8 0 0 1-8 8h0a8 8 0 0 1-8-8v-6Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M22 13h2.5a3.5 3.5 0 0 1 0 7H22"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M11 3c-1.2 1.2-1.2 2.8 0 4M16 3c-1.2 1.2-1.2 2.8 0 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
