import type { ComponentType, ReactNode, Ref, UIEventHandler } from 'react';

export type WorkspaceIcon = ComponentType<{ className?: string }>;

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function WorkspacePageHeading({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={classes('flex flex-wrap items-end justify-between gap-3 ', className)}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type WorkspaceTab<Id extends string = string> = {
  id: Id;
  label: string;
  icon?: WorkspaceIcon;
  badge?: ReactNode;
};

export function WorkspaceLineTabs<Id extends string>({
  items,
  activeId,
  onChange,
  trailing,
  className,
}: {
  items: readonly WorkspaceTab<Id>[];
  activeId: Id;
  onChange: (id: Id) => void;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={classes(
        'flex w-full items-end justify-between gap-3 border-b border-border',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-none">
        {items.map((item) => {
          const active = activeId === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onChange(item.id)}
              className={classes(
                'relative flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {Icon ? <Icon className="size-4" /> : null}
              {item.label}
              {item.badge}
              {active ? (
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-2 motion-safe:duration-200"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      {trailing ? <div className="shrink-0 pb-1.5">{trailing}</div> : null}
    </div>
  );
}

export function DataWorkspaceShell({
  title,
  description,
  actions,
  navigation,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  navigation?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={classes('px-6 md:px-8', className)}>
      <WorkspacePageHeading title={title} description={description} actions={actions} />
      {navigation ? <div className="mt-7">{navigation}</div> : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

export type WorkspaceSettingsItem<Id extends string = string> = {
  id: Id;
  label: string;
  icon: WorkspaceIcon;
  hidden?: boolean;
};
export type WorkspaceSettingsGroup<Id extends string = string> = {
  label: string;
  items: readonly WorkspaceSettingsItem<Id>[];
};

export function WorkspaceSettingsLayout<Id extends string>({
  groups,
  activeId,
  onSelect,
  children,
  fullWidth = false,
}: {
  groups: readonly WorkspaceSettingsGroup<Id>[];
  activeId: Id | null;
  onSelect: (id: Id) => void;
  children: ReactNode;
  fullWidth?: boolean;
}) {
  const items = groups.flatMap((group) => group.items).filter((item) => !item.hidden);
  return (
    <div className="flex h-full min-h-125 flex-col lg:flex-row">
      <nav className="flex gap-1 overflow-x-auto border-b bg-muted/40 p-2 lg:hidden">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={classes(
                'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors',
                active
                  ? 'bg-background font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" />
              {item.label}
            </button>
          );
        })}
      </nav>
      <aside className="hidden w-60 shrink-0 border-r bg-muted/40 lg:block">
        <nav className="flex h-full flex-col gap-7 p-4">
          {groups.map((group) => {
            const visible = group.items.filter((item) => !item.hidden);
            if (!visible.length) return null;
            return (
              <div key={group.label}>
                <h4 className="mb-2 px-3 text-xs font-semibold text-muted-foreground">
                  {group.label}
                </h4>
                <div className="space-y-1">
                  {visible.map((item) => {
                    const Icon = item.icon;
                    const active = item.id === activeId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelect(item.id)}
                        className={classes(
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors',
                          active
                            ? 'bg-sidebar-accent/50 font-medium text-foreground dark:bg-white/10'
                            : 'font-normal text-muted-foreground/90 hover:bg-muted hover:text-foreground',
                        )}
                      >
                        <Icon className="size-4" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className={fullWidth ? 'w-full p-6 lg:px-10 lg:py-8' : 'mx-auto max-w-6xl p-6 lg:p-8'}>
          {children}
        </div>
      </main>
    </div>
  );
}

export function ChatWorkspaceShell({
  toolbar,
  children,
  composer,
  dragging = false,
  dragOverlay,
  className,
}: {
  toolbar?: ReactNode;
  children: ReactNode;
  composer?: ReactNode;
  dragging?: boolean;
  dragOverlay?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={classes(
        'relative flex h-full w-full flex-1 flex-col overflow-hidden',
        dragging && 'bg-primary/5',
        className,
      )}
    >
      {dragging ? dragOverlay : null}
      {toolbar ? (
        <div className="relative z-40 flex items-center justify-between px-4 py-2">{toolbar}</div>
      ) : null}
      {children}
      {composer ? (
        <div className="relative z-10 mt-auto px-4 pb-5 pt-3 sm:px-6">{composer}</div>
      ) : null}
    </div>
  );
}

export function ChatMessagesViewport({
  children,
  viewportRef,
  onScroll,
}: {
  children: ReactNode;
  viewportRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      ref={viewportRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden"
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">{children}</div>
    </div>
  );
}

export function ChatEmptyState({
  mark,
  title = 'Chat with your knowledge base',
  description = 'Ask questions and get AI-powered answers grounded in your indexed documents.',
  action,
}: {
  mark?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 pt-[18vh] text-center">
      {mark ? (
        <div className="flex size-14 items-center justify-center rounded-2xl border border-border/60 bg-white/90 text-primary dark:bg-card">
          {mark}
        </div>
      ) : null}
      <h1 className="text-balance text-xl font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function ChatComposerFrame({
  leading,
  children,
  trailing,
}: {
  leading?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <ChatComposerSurface>
      {leading}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing}
    </ChatComposerSurface>
  );
}

export function ChatComposerSurface({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-2 transition focus-within:ring-1 focus-within:ring-ring/20">
      {children}
    </div>
  );
}

export function ChatUserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="whitespace-pre-wrap rounded-2xl rounded-br-md border border-border/25 bg-muted px-4 py-2 text-[15px] leading-relaxed text-foreground">
      {children}
    </div>
  );
}
