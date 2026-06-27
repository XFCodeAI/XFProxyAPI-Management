import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ManagementPageId } from "@/features/management/data";

const logoSrc = `${import.meta.env.BASE_URL}xf.png`;

type SidebarPage = {
  id: ManagementPageId;
  label: string;
  icon: LucideIcon;
};

type AppSidebarProps = {
  activePage: ManagementPageId;
  pages: SidebarPage[];
  onPageChange: (page: ManagementPageId) => void;
};

export function AppSidebar({ activePage, pages, onPageChange }: AppSidebarProps) {
  return (
    <aside className="border-b bg-card lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
      <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 lg:min-h-0 lg:flex-col lg:items-stretch lg:justify-start lg:px-5 lg:py-6">
        <div className="flex items-center gap-3">
          <img
            src={logoSrc}
            alt="XFProxyAPI"
            className="size-10 shrink-0 rounded-lg border bg-primary/10 object-contain"
          />
          <div className="min-w-0">
            <strong className="block truncate text-sm font-semibold">XFProxyAPI</strong>
            <span className="block truncate text-xs text-muted-foreground">Management</span>
          </div>
        </div>

        <ScrollArea className="max-w-[58vw] lg:mt-8 lg:max-w-none">
          <nav className="flex gap-2 lg:grid" aria-label="Main navigation">
            {pages.map((page) => {
              const Icon = page.icon;
              const isActive = activePage === page.id;

              return (
                <Button
                  key={page.id}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-10 shrink-0 justify-start px-3 text-muted-foreground lg:w-full",
                    isActive && "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary"
                  )}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onPageChange(page.id)}
                >
                  <Icon />
                  <span>{page.label}</span>
                </Button>
              );
            })}
          </nav>
        </ScrollArea>
      </div>
    </aside>
  );
}
