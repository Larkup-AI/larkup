'use client';

import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Activity, Database, Loader2, MessageSquare, Zap } from 'lucide-react';
import useSWR from 'swr';
import type { AnalyticsSummary } from '@larkup/core/analytics-store';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function padTimeSeries<T extends { date: string }>(
  data: T[],
  timeframe: string,
  emptyItemFactory: () => Omit<T, 'date'>,
): T[] {
  if (timeframe === 'all' || !data) return data || [];

  let days = 30;
  if (timeframe === '7d') days = 7;
  else if (timeframe === '14d') days = 14;
  else if (timeframe === '30d') days = 30;
  else if (timeframe === '90d') days = 90;

  const padded: T[] = [];
  const today = new Date();

  const dataMap = new Map(data.map((item) => [item.date, item]));

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];

    if (dataMap.has(dateStr)) {
      padded.push(dataMap.get(dateStr)!);
    } else {
      padded.push({ date: dateStr, ...emptyItemFactory() } as T);
    }
  }

  return padded;
}

function formatTokens(num: number): string {
  return (num / 1000000).toFixed(2) + 'M';
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) {
    if (cost < 0.0001) return '<$0.0001';
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

export function AnalyticsDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [timeframe, setTimeframe] = useState('14d');

  const {
    data: summary,
    isLoading,
    error,
  } = useSWR<AnalyticsSummary>(`/api/analytics?timeframe=${timeframe}`, fetcher);

  if (isLoading) {
    return (
      <div className="p-8 flex-col gap-2 text-center text-muted-foreground animate-pulse flex items-center justify-center h-full">
        <Loader2 className="size-6 animate-spin" />
        <span className="text-[15px]">Loading analytics data...</span>
      </div>
    );
  }

  if (error || !summary) {
    return <div className="p-8 text-center text-destructive">Failed to load analytics data.</div>;
  }

  const isServerEmpty =
    !summary.serverTimeSeries?.length || summary.serverTimeSeries.every((d) => d.requests === 0);
  const isIndexingEmpty =
    !summary.embeddingTimeSeries?.length ||
    summary.embeddingTimeSeries.every((d) => d.tokens === 0);
  const isChatEmpty =
    !summary.chatTimeSeries?.length || summary.chatTimeSeries.every((d) => d.tokens === 0);

  const DummyOverlay = ({ title, description }: { title: string; description: string }) => (
    <div className="absolute inset-0 z-10 flex items-center justify-center  rounded-md">
      <div className="flex flex-col items-center space-y-2  dark:bg-zinc-900/90 px-5 py-4 rounded-lg max-w-xl text-center">
        <div className="p-2 border border-border/70 rounded-lg bg-white">
          <Activity className="size-6 text-black/80" />
        </div>
        <div className="space-y-1">
          <p className="text-[16px] font-semibold text-foreground">{title}</p>
          <p className="text-[13px] text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="shadow-none rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <Activity className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCost(summary.totalCost)}</div>
            <p className="text-xs text-muted-foreground">Across all paid models</p>
          </CardContent>
        </Card>
        <Card className="shadow-none rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Chat Tokens</CardTitle>
            <MessageSquare className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(summary.totalChatTokens)}</div>
            <p className="text-xs text-muted-foreground">Processed in conversations</p>
          </CardContent>
        </Card>
        <Card className="shadow-none rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Embedding Tokens</CardTitle>
            <Database className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(summary.totalEmbeddingTokens)}</div>
            <p className="text-xs text-muted-foreground">Processed during indexing</p>
          </CardContent>
        </Card>
        <Card className="shadow-none rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
            <Zap className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalRequests.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">To local RAG server this week</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <TabsList className="inline-flex bg-white/70 dark:bg-muted/70 h-9 items-center justify-center rounded-lg border border-border p-0.5 text-muted-foreground">
            <TabsTrigger
              value="overview"
              className="inline-flex items-center h-9 justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]: hover:text-foreground"
            >
              <Activity className="size-3.5 mr-1.5" />
              Server Traffic
            </TabsTrigger>
            <TabsTrigger
              value="indexing"
              className="inline-flex items-center h-9 justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]: hover:text-foreground"
            >
              <Database className="size-3.5 mr-1.5" />
              Indexing Usage
            </TabsTrigger>
            <TabsTrigger
              value="chat"
              className="inline-flex items-center h-9 justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]: hover:text-foreground"
            >
              <MessageSquare className="size-3.5 mr-1.5" />
              Chat Usage
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center">
            <Select value={timeframe} onValueChange={(val) => val && setTimeframe(val)}>
              <SelectTrigger className="w-[140px] h-10! text-sm bg-white dark:bg-background focus:ring-0 focus:border-input data-[state=open]:ring-0 data-[state=open]:border-input outline-none focus:outline-none">
                <SelectValue placeholder="Select timeframe">
                  {timeframe === '7d' && 'Last 7 days'}
                  {timeframe === '14d' && 'Last 14 days'}
                  {timeframe === '30d' && 'Last 30 days'}
                  {timeframe === '90d' && 'Last 90 days'}
                  {timeframe === 'all' && 'All time'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="14d">Last 14 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <TabsContent value="overview" className="space-y-4">
          <Card className="shadow-none! rounded-xl">
            <CardHeader>
              <CardTitle>Requests to RAG Server</CardTitle>
              <CardDescription>
                Daily requests sent to your local or remote deployed RAG endpoints.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-2 sm:p-6">
              <div className="h-[300px] w-full relative">
                {isServerEmpty && (
                  <DummyOverlay
                    title="No Server Traffic Yet"
                    description="Once you start sending requests to the RAG server, usage will appear here."
                  />
                )}
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  className="[&_.recharts-surface]:outline-none [&_.recharts-wrapper]:outline-none"
                >
                  <BarChart
                    data={padTimeSeries(summary.serverTimeSeries, timeframe, () => ({
                      requests: 0,
                      avgLatencyMs: 0,
                    }))}
                    margin={{
                      top: 10,
                      right: 30,
                      left: 0,
                      bottom: 0,
                    }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="currentColor"
                      strokeOpacity={0.1}
                    />
                    <XAxis
                      dataKey="date"
                      stroke="currentColor"
                      strokeOpacity={0.5}
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={20}
                      tickFormatter={(val) => {
                        if (!val.includes('-')) return val;
                        const [y, m, d] = val.split('-');
                        return new Date(
                          parseInt(y, 10),
                          parseInt(m, 10) - 1,
                          parseInt(d, 10),
                        ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      }}
                    />
                    <YAxis
                      allowDecimals={false}
                      stroke="currentColor"
                      strokeOpacity={0.5}
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${value}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--color-background)',
                        borderColor: 'var(--color-border)',
                        borderRadius: '8px',
                      }}
                      itemStyle={{ color: 'var(--color-foreground)' }}
                      cursor={{ fill: 'var(--color-muted)', opacity: 0.4 }}
                    />
                    <Bar
                      dataKey="requests"
                      fill="#3b82f6"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                      activeBar={{
                        className: 'outline-none focus:outline-none',
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="indexing" className="space-y-4">
          <Card className="shadow-none rounded-xl">
            <CardHeader>
              <CardTitle>Indexing Token Usage</CardTitle>
              <CardDescription>Daily tokens processed for document indexing.</CardDescription>
            </CardHeader>
            <CardContent className="px-2 sm:p-6">
              <div className="h-[300px] w-full relative">
                {isIndexingEmpty && (
                  <DummyOverlay
                    title="No Indexing Data Yet"
                    description="Add documents to your knowledge bases to see embedding token usage here."
                  />
                )}
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  className="[&_.recharts-surface]:outline-none [&_.recharts-wrapper]:outline-none"
                >
                  <AreaChart
                    data={padTimeSeries(summary.embeddingTimeSeries, timeframe, () => ({
                      tokens: 0,
                      cost: 0,
                      requests: 0,
                    }))}
                    margin={{
                      top: 10,
                      right: 30,
                      left: 0,
                      bottom: 0,
                    }}
                  >
                    <defs>
                      <linearGradient id="colorIndexing" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="currentColor"
                      strokeOpacity={0.1}
                    />
                    <XAxis
                      dataKey="date"
                      stroke="currentColor"
                      strokeOpacity={0.5}
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={20}
                      tickFormatter={(val) => {
                        if (!val.includes('-')) return val;
                        const [y, m, d] = val.split('-');
                        return new Date(
                          parseInt(y, 10),
                          parseInt(m, 10) - 1,
                          parseInt(d, 10),
                        ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      }}
                    />
                    <YAxis
                      allowDecimals={false}
                      stroke="currentColor"
                      strokeOpacity={0.5}
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${value >= 1000 ? value / 1000 + 'k' : value}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--color-background)',
                        borderColor: 'var(--color-border)',
                        borderRadius: '8px',
                      }}
                      itemStyle={{ color: 'var(--color-foreground)' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="tokens"
                      stroke="#f97316"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorIndexing)"
                      activeDot={{
                        r: 4,
                        className: 'outline-none focus:outline-none',
                        strokeWidth: 0,
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="chat" className="space-y-4">
          <Card className="shadow-none rounded-xl">
            <CardHeader>
              <CardTitle>Chat Token Usage</CardTitle>
              <CardDescription>Daily tokens processed for chat completions.</CardDescription>
            </CardHeader>
            <CardContent className="px-2 sm:p-6">
              <div className="h-[300px] w-full relative">
                {isChatEmpty && (
                  <DummyOverlay
                    title="No Chat Data Yet"
                    description="Chat with the AI to see your token usage metrics here."
                  />
                )}
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  className="[&_.recharts-surface]:outline-none [&_.recharts-wrapper]:outline-none"
                >
                  <AreaChart
                    data={padTimeSeries(summary.chatTimeSeries, timeframe, () => ({
                      tokens: 0,
                      cost: 0,
                      requests: 0,
                    }))}
                    margin={{
                      top: 10,
                      right: 30,
                      left: 0,
                      bottom: 0,
                    }}
                  >
                    <defs>
                      <linearGradient id="colorChat" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="currentColor"
                      strokeOpacity={0.1}
                    />
                    <XAxis
                      dataKey="date"
                      stroke="currentColor"
                      strokeOpacity={0.5}
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={20}
                      tickFormatter={(val) => {
                        if (!val.includes('-')) return val;
                        const [y, m, d] = val.split('-');
                        return new Date(
                          parseInt(y, 10),
                          parseInt(m, 10) - 1,
                          parseInt(d, 10),
                        ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      }}
                    />
                    <YAxis
                      allowDecimals={false}
                      stroke="currentColor"
                      strokeOpacity={0.5}
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${value >= 1000 ? value / 1000 + 'k' : value}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--color-background)',
                        borderColor: 'var(--color-border)',
                        borderRadius: '8px',
                      }}
                      itemStyle={{ color: 'var(--color-foreground)' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="tokens"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorChat)"
                      activeDot={{
                        r: 4,
                        className: 'outline-none focus:outline-none',
                        strokeWidth: 0,
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
