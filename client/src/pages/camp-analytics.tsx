import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Eye, Users, Clock, ArrowDown, MousePointerClick, Monitor, Smartphone, Tablet, TrendingUp, DollarSign, UserCheck, BarChart3, Target, ArrowRight, Percent, RefreshCw, CalendarDays } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency as _fc, formatCompact } from "@/lib/format";

function formatCurrency(cents: number) {
  return _fc(cents, { fromCents: true });
}

function formatNumber(n: number) {
  return formatCompact(n);
}

function MetricCard({ title, value, subtitle, icon: Icon, color = "blue" }: { title: string; value: string | number; subtitle?: string; icon: any; color?: string }) {
  const colorMap: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50 dark:bg-blue-900/20",
    green: "text-green-600 bg-green-50 dark:bg-green-900/20",
    orange: "text-orange-600 bg-orange-50 dark:bg-orange-900/20",
    purple: "text-purple-600 bg-purple-50 dark:bg-purple-900/20",
    red: "text-red-600 bg-red-50 dark:bg-red-900/20",
    gold: "text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20",
  };
  return (
    <Card data-testid={`metric-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${colorMap[color] || colorMap.blue}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground truncate">{title}</p>
            <p className="text-xl font-bold" data-testid={`value-${title.toLowerCase().replace(/\s+/g, '-')}`}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FunnelStep({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3" data-testid={`funnel-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="w-32 text-sm font-medium truncate">{label}</div>
      <div className="flex-1">
        <Progress value={pct} className="h-6" />
      </div>
      <div className="w-20 text-right">
        <span className="font-bold text-sm">{formatNumber(value)}</span>
        <span className="text-xs text-muted-foreground ml-1">({pct}%)</span>
      </div>
    </div>
  );
}

function OverviewTab({ dateRange, campSlug, orgId }: { dateRange: string; campSlug: string; orgId?: number }) {
  const params = new URLSearchParams();
  const [from, to] = getDateRange(dateRange);
  params.set("from", from);
  params.set("to", to);
  if (campSlug !== "all") params.set("campSlug", campSlug);
  if (orgId) params.set("orgId", String(orgId));

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/overview", dateRange, campSlug],
    queryFn: () => fetch(`/api/admin/analytics/overview?${params}`).then(r => r.json()),
  });

  const { data: timeline, isLoading: timelineLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/analytics/timeline", dateRange, campSlug],
    queryFn: () => fetch(`/api/admin/analytics/timeline?${params}`).then(r => r.json()),
  });

  if (isLoading) return <div className="flex items-center justify-center py-16"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-center py-16 text-muted-foreground">No data available</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard title="Page Views" value={formatNumber(data.pageViews?.total || 0)} subtitle={`${formatNumber(data.pageViews?.unique || 0)} unique`} icon={Eye} color="blue" />
        <MetricCard title="Sessions" value={formatNumber(data.sessions || 0)} icon={Users} color="purple" />
        <MetricCard title="Avg Time on Page" value={`${data.avgTimeOnPage || 0}s`} icon={Clock} color="green" />
        <MetricCard title="Bounce Rate" value={`${data.bounceRate || 0}%`} icon={ArrowDown} color="orange" />
        <MetricCard title="CTA Click Rate" value={`${data.ctaRate || 0}%`} subtitle={`${formatNumber(data.ctaClicks || 0)} clicks`} icon={MousePointerClick} color="gold" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Visitors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm">New Visitors</span>
                <Badge variant="secondary" data-testid="badge-new-visitors">{formatNumber(data.newVisitors || 0)}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Returning Visitors</span>
                <Badge variant="secondary" data-testid="badge-returning-visitors">{formatNumber(data.returningVisitors || 0)}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Avg Scroll Depth</span>
                <Badge variant="outline" data-testid="badge-scroll-depth">{data.avgScrollDepth || 0}%</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Device Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(data.devices || []).map((d: any) => {
                const DeviceIcon = d.device === 'mobile' ? Smartphone : d.device === 'tablet' ? Tablet : Monitor;
                const total = (data.devices || []).reduce((s: number, x: any) => s + Number(x.count), 0);
                const pct = total > 0 ? Math.round((Number(d.count) / total) * 100) : 0;
                return (
                  <div key={d.device} className="flex items-center gap-2" data-testid={`device-${d.device}`}>
                    <DeviceIcon className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm capitalize flex-1">{d.device || 'Unknown'}</span>
                    <span className="text-sm font-medium">{pct}%</span>
                    <span className="text-xs text-muted-foreground">({formatNumber(Number(d.count))})</span>
                  </div>
                );
              })}
              {(data.devices || []).length === 0 && <p className="text-sm text-muted-foreground">No device data yet</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Traffic Sources</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(data.sources || []).map((s: any) => (
              <div key={s.source} className="p-3 rounded-lg bg-muted/50" data-testid={`source-${(s.source || '').toLowerCase().replace(/\s+/g, '-')}`}>
                <p className="text-xs text-muted-foreground truncate">{s.source || 'Unknown'}</p>
                <p className="text-lg font-bold">{formatNumber(Number(s.count))}</p>
              </div>
            ))}
            {(data.sources || []).length === 0 && <p className="text-sm text-muted-foreground col-span-4">No source data yet</p>}
          </div>
        </CardContent>
      </Card>

      {timeline && timeline.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Daily Traffic</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {timeline.map((day: any) => {
                const maxPV = Math.max(...timeline.map((d: any) => Number(d.page_views || 0)), 1);
                const pct = (Number(day.page_views || 0) / maxPV) * 100;
                return (
                  <div key={day.date} className="flex items-center gap-2 text-xs">
                    <span className="w-20 text-muted-foreground">{new Date(day.date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}</span>
                    <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-primary/60 rounded" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-16 text-right font-medium">{day.page_views} PV</span>
                    <span className="w-16 text-right text-muted-foreground">{day.unique_visitors} UV</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FunnelTab({ dateRange, campSlug, orgId }: { dateRange: string; campSlug: string; orgId?: number }) {
  const params = new URLSearchParams();
  const [from, to] = getDateRange(dateRange);
  params.set("from", from);
  params.set("to", to);
  if (campSlug !== "all") params.set("campSlug", campSlug);
  if (orgId) params.set("orgId", String(orgId));

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/funnel", dateRange, campSlug],
    queryFn: () => fetch(`/api/admin/analytics/funnel?${params}`).then(r => r.json()),
  });

  if (isLoading) return <div className="flex items-center justify-center py-16"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-center py-16 text-muted-foreground">No data available</div>;

  const topOfFunnel = data.pageViewSessions || 1;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2"><Target className="w-4 h-4" /> Registration Funnel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FunnelStep label="Site Visits" value={data.pageViewSessions || 0} total={topOfFunnel} color="blue" />
          <div className="flex items-center gap-2 pl-32 text-muted-foreground"><ArrowRight className="w-3 h-3" /><span className="text-xs">→ CTA Clicks</span></div>
          <FunnelStep label="CTA Clicks" value={data.ctaClickSessions || 0} total={topOfFunnel} color="purple" />
          <div className="flex items-center gap-2 pl-32 text-muted-foreground"><ArrowRight className="w-3 h-3" /><span className="text-xs">→ Form Views</span></div>
          <FunnelStep label="Form Views" value={data.formViewSessions || 0} total={topOfFunnel} color="green" />
          <div className="flex items-center gap-2 pl-32 text-muted-foreground"><ArrowRight className="w-3 h-3" /><span className="text-xs">→ Registrations</span></div>
          <FunnelStep label="Completed" value={data.completedRegistrations || 0} total={topOfFunnel} color="gold" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard title="Drop-off Rate" value={`${data.dropOffRate || 0}%`} icon={ArrowDown} color="red" />
        <MetricCard title="Abandoned" value={data.abandonedRegistrations || 0} icon={Percent} color="orange" />
        <MetricCard title="Conversion Rate" value={`${topOfFunnel > 0 ? ((data.completedRegistrations || 0) / topOfFunnel * 100).toFixed(1) : 0}%`} icon={TrendingUp} color="green" />
      </div>

      {data.steps && data.steps.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Form Steps</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.steps.map((s: any) => (
                <div key={s.step} className="flex justify-between items-center text-sm">
                  <span>Step: {s.step}</span>
                  <Badge variant="secondary">{formatNumber(Number(s.count))} sessions</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RevenueTab({ dateRange, campSlug, orgId }: { dateRange: string; campSlug: string; orgId?: number }) {
  const params = new URLSearchParams();
  const [from, to] = getDateRange(dateRange);
  params.set("from", from);
  params.set("to", to);
  if (campSlug !== "all") params.set("campSlug", campSlug);
  if (orgId) params.set("orgId", String(orgId));

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/revenue", dateRange, campSlug],
    queryFn: () => fetch(`/api/admin/analytics/revenue?${params}`).then(r => r.json()),
  });

  if (isLoading) return <div className="flex items-center justify-center py-16"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-center py-16 text-muted-foreground">No data available</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard title="Total Revenue" value={formatCurrency(data.totalRevenue || 0)} icon={DollarSign} color="green" />
        <MetricCard title="Registrations" value={formatNumber(data.totalRegistrations || 0)} icon={UserCheck} color="blue" />
        <MetricCard title="Avg Order Value" value={formatCurrency(data.avgOrderValue || 0)} icon={TrendingUp} color="purple" />
        <MetricCard title="Total Discounts" value={formatCurrency(data.totalDiscounts || 0)} subtitle={`${data.discountedOrders || 0} orders`} icon={Percent} color="orange" />
      </div>

      {data.refundedOrders > 0 && (
        <Card className="border-red-200 dark:border-red-800">
          <CardContent className="p-4 flex items-center gap-3">
            <Badge variant="destructive">{data.refundedOrders} Refunds</Badge>
            <span className="text-sm text-muted-foreground">Total refunded: {formatCurrency(data.refundAmount || 0)}</span>
          </CardContent>
        </Card>
      )}

      {data.campRevenue && data.campRevenue.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Revenue by Camp</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.campRevenue.map((c: any) => {
                const maxRev = Math.max(...data.campRevenue.map((x: any) => Number(x.revenue)), 1);
                const pct = (Number(c.revenue) / maxRev) * 100;
                return (
                  <div key={c.camp_slug} data-testid={`camp-revenue-${c.camp_slug}`}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium truncate">{c.camp_name}</span>
                      <span>{formatCurrency(Number(c.revenue))}</span>
                    </div>
                    <div className="h-2 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-green-500 rounded" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{c.registrations} registrations</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {data.dailyRevenue && data.dailyRevenue.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Daily Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {data.dailyRevenue.map((d: any) => {
                const maxRev = Math.max(...data.dailyRevenue.map((x: any) => Number(x.revenue)), 1);
                const pct = (Number(d.revenue) / maxRev) * 100;
                return (
                  <div key={d.date} className="flex items-center gap-2 text-xs">
                    <span className="w-20 text-muted-foreground">{new Date(d.date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}</span>
                    <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-green-500/60 rounded" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-20 text-right font-medium">{formatCurrency(Number(d.revenue))}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {data.productMix && data.productMix.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Product Mix</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {data.productMix.map((p: any) => (
                <div key={p.product_type} className="p-3 rounded-lg bg-muted/50 text-center" data-testid={`product-${p.product_type}`}>
                  <p className="text-xs text-muted-foreground capitalize">{p.product_type || 'Standard'}</p>
                  <p className="text-lg font-bold">{formatNumber(Number(p.count))}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CustomersTab({ dateRange, orgId }: { dateRange: string; orgId?: number }) {
  const params = new URLSearchParams();
  const [from, to] = getDateRange(dateRange);
  params.set("from", from);
  params.set("to", to);
  if (orgId) params.set("orgId", String(orgId));

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/customers", dateRange],
    queryFn: () => fetch(`/api/admin/analytics/customers?${params}`).then(r => r.json()),
  });

  if (isLoading) return <div className="flex items-center justify-center py-16"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-center py-16 text-muted-foreground">No data available</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard title="Total Families" value={formatNumber(data.totalFamilies || 0)} icon={Users} color="blue" />
        <MetricCard title="New Families" value={formatNumber(data.newFamilies || 0)} icon={UserCheck} color="green" />
        <MetricCard title="Returning Rate" value={`${data.returningRate || 0}%`} icon={RefreshCw} color="purple" />
        <MetricCard title="Avg LTV" value={formatCurrency(data.avgLTV || 0)} icon={DollarSign} color="gold" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Customer Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm">New Families</span>
              <Badge variant="default" data-testid="badge-cust-new">{data.newFamilies || 0}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm">Returning Families</span>
              <Badge variant="secondary" data-testid="badge-cust-returning">{data.returningFamilies || 0}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm">Multi-Child Families</span>
              <Badge variant="outline" data-testid="badge-cust-multi">{data.multiChildFamilies || 0}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Engagement Metrics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm">Avg Registrations/Family</span>
              <span className="font-bold" data-testid="value-avg-regs">{data.avgRegsPerFamily || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm">Average Lifetime Value</span>
              <span className="font-bold" data-testid="value-ltv">{formatCurrency(data.avgLTV || 0)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CampPerformanceTab({ dateRange, orgId }: { dateRange: string; orgId?: number }) {
  const params = new URLSearchParams();
  const [from, to] = getDateRange(dateRange);
  params.set("from", from);
  params.set("to", to);
  if (orgId) params.set("orgId", String(orgId));

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/camps", dateRange],
    queryFn: () => fetch(`/api/admin/analytics/camps?${params}`).then(r => r.json()),
  });

  if (isLoading) return <div className="flex items-center justify-center py-16"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-center py-16 text-muted-foreground">No data available</div>;

  return (
    <div className="space-y-6">
      {data.campPerformance && data.campPerformance.length > 0 ? (
        <div className="grid gap-4">
          {data.campPerformance.map((camp: any) => (
            <Card key={camp.id} data-testid={`camp-perf-${camp.slug}`}>
              <CardContent className="p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold truncate">{camp.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {camp.start_date ? new Date(camp.start_date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBD'}
                      {camp.end_date && ` — ${new Date(camp.end_date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                      {camp.age_min && camp.age_max && ` · Ages ${camp.age_min}–${camp.age_max}`}
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <div className="text-center">
                      <p className="text-lg font-bold text-primary">{camp.registrations || 0}</p>
                      <p className="text-xs text-muted-foreground">Registrations</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-green-600">{formatCurrency(Number(camp.revenue || 0))}</p>
                      <p className="text-xs text-muted-foreground">Revenue</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-purple-600">{camp.registrations > 0 ? formatCurrency(Math.round(Number(camp.revenue || 0) / Number(camp.registrations))) : '$0'}</p>
                      <p className="text-xs text-muted-foreground">Avg/Reg</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground">No camps found</div>
      )}
    </div>
  );
}

function HeatmapTab({ dateRange, campSlug, orgId }: { dateRange: string; campSlug: string; orgId?: number }) {
  const params = new URLSearchParams();
  const [from, to] = getDateRange(dateRange);
  params.set("from", from);
  params.set("to", to);
  if (campSlug !== "all") params.set("campSlug", campSlug);
  if (orgId) params.set("orgId", String(orgId));

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/heatmap", dateRange, campSlug],
    queryFn: () => fetch(`/api/admin/analytics/heatmap?${params}`).then(r => r.json()),
  });

  if (isLoading) return <div className="flex items-center justify-center py-16"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-center py-16 text-muted-foreground">No data available</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Most Clicked Elements</CardTitle>
        </CardHeader>
        <CardContent>
          {data.topClicked && data.topClicked.length > 0 ? (
            <div className="space-y-2">
              {data.topClicked.map((item: any, i: number) => {
                const maxClicks = Number(data.topClicked[0]?.clicks || 1);
                const pct = (Number(item.clicks) / maxClicks) * 100;
                return (
                  <div key={`${item.element}-${i}`} className="flex items-center gap-2" data-testid={`clicked-element-${i}`}>
                    <span className="w-8 text-xs text-muted-foreground text-right">#{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm truncate font-medium">{item.element || 'Unknown'}</span>
                        {item.testid && <Badge variant="outline" className="text-[10px]">{item.testid}</Badge>}
                      </div>
                      <div className="h-1.5 bg-muted rounded mt-1 overflow-hidden">
                        <div className="h-full bg-primary/60 rounded" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <span className="text-sm font-bold w-12 text-right">{item.clicks}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No click data yet</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Scroll Depth Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          {data.scrollDropoff && data.scrollDropoff.length > 0 ? (
            <div className="space-y-3">
              {data.scrollDropoff.map((s: any) => {
                const total = data.scrollDropoff.reduce((sum: number, x: any) => sum + Number(x.count), 0);
                const pct = total > 0 ? Math.round((Number(s.count) / total) * 100) : 0;
                return (
                  <div key={s.range} className="flex items-center gap-3" data-testid={`scroll-${s.range}`}>
                    <span className="w-20 text-sm">{s.range}</span>
                    <div className="flex-1">
                      <Progress value={pct} className="h-4" />
                    </div>
                    <span className="w-16 text-right text-sm">{pct}% ({s.count})</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No scroll data yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OrderTimingTab({ dateRange, orgId }: { dateRange: string; orgId?: number }) {
  const params = new URLSearchParams();
  const [from, to] = getDateRange(dateRange);
  params.set("from", from);
  params.set("to", to);
  if (orgId) params.set("orgId", String(orgId));

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/order-timing", dateRange, orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/analytics/order-timing?${params}`);
      if (!r.ok) throw new Error(`Failed to load order timing data`);
      return r.json();
    },
  });

  if (isLoading) return <div className="flex items-center justify-center py-16"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-center py-16 text-muted-foreground">No data available</div>;

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const dayLabelsMF = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const grid: Record<string, number> = {};
  let maxCount = 0;
  (data.heatmap || []).forEach((cell: any) => {
    const key = `${cell.day_of_week}-${cell.hour_of_day}`;
    const count = Number(cell.order_count);
    grid[key] = count;
    if (count > maxCount) maxCount = count;
  });

  function getCellColor(count: number): string {
    if (count === 0 || maxCount === 0) return "bg-muted/30";
    const intensity = count / maxCount;
    if (intensity > 0.8) return "bg-emerald-500";
    if (intensity > 0.6) return "bg-emerald-400";
    if (intensity > 0.4) return "bg-emerald-300 dark:bg-emerald-600";
    if (intensity > 0.2) return "bg-emerald-200 dark:bg-emerald-700";
    return "bg-emerald-100 dark:bg-emerald-800";
  }

  const dailySorted = [...(data.dailyTotals || [])].sort((a: any, b: any) => Number(b.order_count) - Number(a.order_count));
  const peakDay = dailySorted[0];
  const hourlySorted = [...(data.hourlyTotals || [])].sort((a: any, b: any) => Number(b.order_count) - Number(a.order_count));
  const peakHour = hourlySorted[0];

  const totalOrders = Number(data.summary?.total || 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          title="Total Orders"
          value={formatNumber(totalOrders)}
          subtitle={`${dateRange === "30d" ? "Last 30 days" : dateRange === "7d" ? "Last 7 days" : dateRange === "90d" ? "Last 90 days" : "Selected period"}`}
          icon={CalendarDays}
          color="blue"
        />
        <MetricCard
          title="Peak Day"
          value={peakDay ? dayLabels[Number(peakDay.day_of_week)] : "—"}
          subtitle={peakDay ? `${peakDay.order_count} orders` : "No data"}
          icon={TrendingUp}
          color="green"
        />
        <MetricCard
          title="Peak Hour"
          value={peakHour ? `${Number(peakHour.hour_of_day) === 0 ? '12' : Number(peakHour.hour_of_day) > 12 ? Number(peakHour.hour_of_day) - 12 : peakHour.hour_of_day}${Number(peakHour.hour_of_day) < 12 ? 'am' : 'pm'}` : "—"}
          subtitle={peakHour ? `${peakHour.order_count} orders` : "No data"}
          icon={Clock}
          color="purple"
        />
        <MetricCard
          title="Revenue"
          value={formatCurrency(Number(data.summary?.revenue || 0))}
          icon={DollarSign}
          color="gold"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CalendarDays className="w-4 h-4" />
            Order Heatmap — Day of Week × Time of Day
          </CardTitle>
          <p className="text-xs text-muted-foreground">Showing when customers place orders (NZ time). Darker = more orders.</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              <div className="flex">
                <div className="w-12 flex-shrink-0" />
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="flex-1 text-center text-[10px] text-muted-foreground font-medium px-0.5">
                    {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
                  </div>
                ))}
              </div>

              {dayOrder.map((dow, dayIdx) => (
                <div key={dow} className="flex items-center gap-0" data-testid={`heatmap-row-${dayLabelsMF[dayIdx].toLowerCase()}`}>
                  <div className="w-12 flex-shrink-0 text-xs font-medium text-muted-foreground pr-2 text-right">
                    {dayLabelsMF[dayIdx]}
                  </div>
                  {Array.from({ length: 24 }, (_, h) => {
                    const count = grid[`${dow}-${h}`] || 0;
                    return (
                      <div
                        key={h}
                        className={`flex-1 aspect-square m-[1px] rounded-sm ${getCellColor(count)} transition-colors cursor-default group relative`}
                        data-testid={`heatmap-cell-${dayLabelsMF[dayIdx].toLowerCase()}-${h}`}
                      >
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
                          <div className="bg-popover text-popover-foreground border rounded-md shadow-md px-2 py-1 text-[11px] whitespace-nowrap">
                            <span className="font-medium">{dayLabelsMF[dayIdx]} {h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`}</span>
                            <br />
                            {count} order{count !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}

              <div className="flex items-center justify-end gap-2 mt-3 pt-2 border-t">
                <span className="text-[10px] text-muted-foreground">Fewer</span>
                <div className="flex gap-0.5">
                  <div className="w-3 h-3 rounded-sm bg-muted/30" />
                  <div className="w-3 h-3 rounded-sm bg-emerald-100 dark:bg-emerald-800" />
                  <div className="w-3 h-3 rounded-sm bg-emerald-200 dark:bg-emerald-700" />
                  <div className="w-3 h-3 rounded-sm bg-emerald-300 dark:bg-emerald-600" />
                  <div className="w-3 h-3 rounded-sm bg-emerald-400" />
                  <div className="w-3 h-3 rounded-sm bg-emerald-500" />
                </div>
                <span className="text-[10px] text-muted-foreground">More</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Orders by Day of Week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {dayOrder.map((dow, dayIdx) => {
                const dayData = (data.dailyTotals || []).find((d: any) => Number(d.day_of_week) === dow);
                const count = Number(dayData?.order_count || 0);
                const maxDay = Math.max(...(data.dailyTotals || []).map((d: any) => Number(d.order_count || 0)), 1);
                const pct = (count / maxDay) * 100;
                const isTop = peakDay && Number(peakDay.day_of_week) === dow;
                return (
                  <div key={dow} className="flex items-center gap-2" data-testid={`day-bar-${dayLabelsMF[dayIdx].toLowerCase()}`}>
                    <span className={`w-8 text-xs font-medium ${isTop ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>{dayLabelsMF[dayIdx]}</span>
                    <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                      <div className={`h-full rounded ${isTop ? 'bg-emerald-500' : 'bg-primary/40'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className={`w-8 text-right text-xs font-medium ${isTop ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{count}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Orders by Time of Day</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {[
                { label: "Morning", range: "6am–12pm", hours: [6, 7, 8, 9, 10, 11] },
                { label: "Afternoon", range: "12pm–5pm", hours: [12, 13, 14, 15, 16] },
                { label: "Evening", range: "5pm–9pm", hours: [17, 18, 19, 20] },
                { label: "Night", range: "9pm–12am", hours: [21, 22, 23] },
                { label: "Late Night", range: "12am–6am", hours: [0, 1, 2, 3, 4, 5] },
              ].map(period => {
                const count = (data.hourlyTotals || [])
                  .filter((h: any) => period.hours.includes(Number(h.hour_of_day)))
                  .reduce((s: number, h: any) => s + Number(h.order_count || 0), 0);
                const pct = totalOrders > 0 ? Math.round((count / totalOrders) * 100) : 0;
                return (
                  <div key={period.label} className="flex items-center gap-2" data-testid={`period-${period.label.toLowerCase().replace(/\s+/g, '-')}`}>
                    <span className="w-20 text-xs font-medium text-muted-foreground">{period.label}</span>
                    <span className="w-16 text-[10px] text-muted-foreground">{period.range}</span>
                    <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-primary/40 rounded" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-12 text-right text-xs font-medium">{count} <span className="text-muted-foreground">({pct}%)</span></span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {totalOrders === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <CalendarDays className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No confirmed orders in this time period yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Once customers start booking, you'll see exactly when they buy — helping you time your campaigns for maximum impact.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function getDateRange(preset: string): [string, string] {
  const now = new Date();
  const to = now.toISOString().split('T')[0];
  let from = to;

  switch (preset) {
    case "7d":
      from = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      break;
    case "30d":
      from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      break;
    case "90d":
      from = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
      break;
    case "1y":
      from = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];
      break;
    case "all":
      from = "2020-01-01";
      break;
    default:
      from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  }
  return [from, to];
}

export default function CampAnalytics() {
  const [dateRange, setDateRange] = useState("30d");
  const [campSlug, setCampSlug] = useState("all");
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id;

  const { data: camps } = useQuery<any[]>({
    queryKey: ["/api/admin/programs"],
  });

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6" data-testid="analytics-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-analytics-title">
            <BarChart3 className="w-6 h-6 text-primary" />
            Analytics
          </h1>
          <p className="text-sm text-muted-foreground">Holiday camp performance, traffic, and revenue insights</p>
        </div>
        <div className="flex gap-2">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-32" data-testid="select-date-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          <Select value={campSlug} onValueChange={setCampSlug}>
            <SelectTrigger className="w-44" data-testid="select-camp-filter">
              <SelectValue placeholder="All camps" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Camps</SelectItem>
              {(camps || []).filter((c: any) => c.type === 'holiday_camp').map((c: any) => (
                <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto" data-testid="analytics-tabs">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="funnel" data-testid="tab-funnel">Funnel</TabsTrigger>
          <TabsTrigger value="revenue" data-testid="tab-revenue">Revenue</TabsTrigger>
          <TabsTrigger value="customers" data-testid="tab-customers">Customers</TabsTrigger>
          <TabsTrigger value="camps" data-testid="tab-camps">Camp Performance</TabsTrigger>
          <TabsTrigger value="heatmap" data-testid="tab-heatmap">Engagement</TabsTrigger>
          <TabsTrigger value="order-timing" data-testid="tab-order-timing">Order Timing</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab dateRange={dateRange} campSlug={campSlug} orgId={orgId} />
        </TabsContent>
        <TabsContent value="funnel">
          <FunnelTab dateRange={dateRange} campSlug={campSlug} orgId={orgId} />
        </TabsContent>
        <TabsContent value="revenue">
          <RevenueTab dateRange={dateRange} campSlug={campSlug} orgId={orgId} />
        </TabsContent>
        <TabsContent value="customers">
          <CustomersTab dateRange={dateRange} orgId={orgId} />
        </TabsContent>
        <TabsContent value="camps">
          <CampPerformanceTab dateRange={dateRange} orgId={orgId} />
        </TabsContent>
        <TabsContent value="heatmap">
          <HeatmapTab dateRange={dateRange} campSlug={campSlug} orgId={orgId} />
        </TabsContent>
        <TabsContent value="order-timing">
          <OrderTimingTab dateRange={dateRange} orgId={orgId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
