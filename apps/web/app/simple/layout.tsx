export default function SimpleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // The SimpleSidebar is rendered by ClientLayoutWrapper when mode === "simple"
  // This layout just passes children through
  return <>{children}</>
}
