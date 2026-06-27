import { CheckCircle2, Clock3, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  events,
  getPageMeta,
  pageEndpointGroups,
  routeRows,
  statusItems,
  type ManagementPageId
} from "@/features/management/data";

type ManagementPageProps = {
  pageId: ManagementPageId;
};

export function ManagementPage({ pageId }: ManagementPageProps) {
  if (pageId === "overview") {
    return <OverviewPage />;
  }

  return <EndpointBackedPage pageId={pageId} />;
}

function OverviewPage() {
  return (
    <PageFrame>
      <StatusGrid />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)]">
        <RoutesCard />
        <ControlPlaneCard />
        <ActivityCard className="xl:col-start-2" />
      </div>
    </PageFrame>
  );
}

function EndpointBackedPage({ pageId }: { pageId: Exclude<ManagementPageId, "overview"> }) {
  const page = getPageMeta(pageId);
  const Icon = page.icon;
  const groups = pageEndpointGroups[pageId];

  return (
    <PageFrame>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" />
              </div>
              <div>
                <CardTitle>{page.title}</CardTitle>
                <CardDescription className="mt-2 max-w-2xl">{page.description}</CardDescription>
              </div>
            </div>
            <Badge variant="outline">{groups.length} domain{groups.length === 1 ? "" : "s"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {groups.map((group) => (
            <EndpointGroupCard key={group.title} group={group} />
          ))}
        </CardContent>
      </Card>
    </PageFrame>
  );
}

function StatusGrid() {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Status summary">
      {statusItems.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.label}>
            <CardContent className="flex gap-4 p-5">
              <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{item.label}</p>
                <p className="mt-1 text-2xl font-semibold">{item.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

function RoutesCard() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardDescription>Routing</CardDescription>
          <CardTitle>Provider distribution</CardTitle>
        </div>
        <Button type="button" variant="outline" size="sm">
          Live
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {routeRows.map((route) => (
          <div
            key={route.model}
            className="grid gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-[minmax(180px,1fr)_minmax(90px,180px)_80px] md:items-center"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{route.model}</p>
              <p className="truncate text-sm text-muted-foreground">{route.provider}</p>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${route.weight}%` }} />
            </div>
            <Badge variant={route.state === "ready" ? "success" : "warning"}>{route.state}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ControlPlaneCard() {
  const domains = Object.keys(pageEndpointGroups).length;
  const endpoints = Object.values(pageEndpointGroups).reduce(
    (count, groups) => count + groups.reduce((inner, group) => inner + group.endpoints.length, 0),
    0
  );

  return (
    <Card>
      <CardHeader>
        <CardDescription>Coverage</CardDescription>
        <CardTitle>Original management map</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-2xl font-semibold">{domains}</p>
          <p className="text-sm text-muted-foreground">sidebar pages mapped to management domains</p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-2xl font-semibold">{endpoints}</p>
          <p className="text-sm text-muted-foreground">backend endpoints represented in page content</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityCard({ className }: { className?: string }) {
  const icons = [RefreshCw, CheckCircle2, Clock3];

  return (
    <Card className={className}>
      <CardHeader>
        <CardDescription>Activity</CardDescription>
        <CardTitle>Recent events</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3">
          {events.map((event, index) => {
            const Icon = icons[index] ?? CheckCircle2;
            return (
              <li key={event.title} className="flex items-center gap-3 rounded-lg border p-3">
                <Icon className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm">{event.title}</span>
                <time className="text-sm text-muted-foreground">{event.time}</time>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function EndpointGroupCard({
  group
}: {
  group: {
    title: string;
    detail: string;
    endpoints: string[];
  };
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold">{group.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{group.detail}</p>
        </div>
        <Badge variant="secondary">{group.endpoints.length} endpoint{group.endpoints.length === 1 ? "" : "s"}</Badge>
      </div>
      <div className="mt-4 grid gap-2">
        {group.endpoints.map((endpoint) => (
          <code
            key={endpoint}
            className="block overflow-x-auto rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground"
          >
            {endpoint}
          </code>
        ))}
      </div>
    </div>
  );
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-5 md:px-6">{children}</div>;
}
