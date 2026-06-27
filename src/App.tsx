import { useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { getPageMeta, managementPages, type ManagementPageId } from "@/features/management/data";
import { ManagementPage } from "@/features/management/management-page";

export function App() {
  const [activePage, setActivePage] = useState<ManagementPageId>("overview");
  const pageMeta = getPageMeta(activePage);

  return (
    <main className="grid min-h-screen bg-background text-foreground lg:grid-cols-[264px_minmax(0,1fr)]">
      <AppSidebar
        activePage={activePage}
        pages={managementPages}
        onPageChange={setActivePage}
      />

      <section className="min-w-0">
        <header className="sticky top-0 z-20 border-b bg-background/90 px-4 py-4 backdrop-blur md:px-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase text-primary">Control plane</p>
              <h1 className="text-2xl font-semibold tracking-normal md:text-3xl">{pageMeta.title}</h1>
            </div>

            <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
              <label className="relative min-w-0 sm:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search routes, models, keys" aria-label="Search" />
              </label>
              <Button variant="outline" size="icon" type="button" aria-label="Refresh">
                <RefreshCw />
              </Button>
            </div>
          </div>
        </header>

        <Separator />

        <ManagementPage pageId={activePage} />
      </section>
    </main>
  );
}

