"use client";

import { useState } from "react";
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
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity, Database, MessageSquare, Zap } from "lucide-react";

// Mock Data
const MOCK_SERVER_REQUESTS = [
  { date: "Dec 18", requests: 300, latency: 45 },
  { date: "Dec 19", requests: 420, latency: 42 },
  { date: "Dec 20", requests: 380, latency: 48 },
  { date: "Dec 21", requests: 510, latency: 50 },
  { date: "Dec 22", requests: 490, latency: 40 },
  { date: "Dec 23", requests: 800, latency: 38 },
  { date: "Dec 24", requests: 620, latency: 35 },
  { date: "Dec 25", requests: 450, latency: 38 },
  { date: "Dec 26", requests: 520, latency: 41 },
  { date: "Dec 27", requests: 390, latency: 44 },
  { date: "Dec 28", requests: 610, latency: 40 },
  { date: "Dec 29", requests: 720, latency: 37 },
  { date: "Dec 30", requests: 840, latency: 36 },
  { date: "Dec 31", requests: 680, latency: 39 },
  { date: "Jan 01", requests: 120, latency: 45 },
  { date: "Jan 02", requests: 340, latency: 42 },
  { date: "Jan 03", requests: 280, latency: 48 },
  { date: "Jan 04", requests: 560, latency: 50 },
  { date: "Jan 05", requests: 430, latency: 40 },
  { date: "Jan 06", requests: 780, latency: 38 },
  { date: "Jan 07", requests: 620, latency: 35 },
];

const MOCK_CHAT_USAGE = [
  { date: "Dec 18", tokens: 210000 },
  { date: "Dec 19", tokens: 420000 },
  { date: "Dec 20", tokens: 380000 },
  { date: "Dec 21", tokens: 550000 },
  { date: "Dec 22", tokens: 480000 },
  { date: "Dec 23", tokens: 710000 },
  { date: "Dec 24", tokens: 620000 },
  { date: "Dec 25", tokens: 430000 },
  { date: "Dec 26", tokens: 520000 },
  { date: "Dec 27", tokens: 390000 },
  { date: "Dec 28", tokens: 610000 },
  { date: "Dec 29", tokens: 730000 },
  { date: "Dec 30", tokens: 850000 },
  { date: "Dec 31", tokens: 680000 },
  { date: "Jan 01", tokens: 120000 },
  { date: "Jan 02", tokens: 340000 },
  { date: "Jan 03", tokens: 280000 },
  { date: "Jan 04", tokens: 560000 },
  { date: "Jan 05", tokens: 430000 },
  { date: "Jan 06", tokens: 780000 },
  { date: "Jan 07", tokens: 620000 },
];

const MOCK_INDEXING_USAGE = [
  { date: "Dec 18", tokens: 800000 },
  { date: "Dec 19", tokens: 0 },
  { date: "Dec 20", tokens: 1200000 },
  { date: "Dec 21", tokens: 400000 },
  { date: "Dec 22", tokens: 0 },
  { date: "Dec 23", tokens: 1500000 },
  { date: "Dec 24", tokens: 0 },
  { date: "Dec 25", tokens: 0 },
  { date: "Dec 26", tokens: 900000 },
  { date: "Dec 27", tokens: 0 },
  { date: "Dec 28", tokens: 0 },
  { date: "Dec 29", tokens: 1100000 },
  { date: "Dec 30", tokens: 0 },
  { date: "Dec 31", tokens: 300000 },
  { date: "Jan 01", tokens: 500000 },
  { date: "Jan 02", tokens: 0 },
  { date: "Jan 03", tokens: 1200000 },
  { date: "Jan 04", tokens: 0 },
  { date: "Jan 05", tokens: 250000 },
  { date: "Jan 06", tokens: 0 },
  { date: "Jan 07", tokens: 800000 },
];

const MOCK_MODELS = [
  { name: "gpt-4o", type: "chat", tokens: 1250000, cost: 6.25, custom: false },
  {
    name: "claude-3-haiku",
    type: "chat",
    tokens: 850000,
    cost: 0.21,
    custom: false,
  },
  {
    name: "llama-3-8b-local",
    type: "chat",
    tokens: 340000,
    cost: 0,
    custom: true,
  },
  {
    name: "text-embedding-3-small",
    type: "embedding",
    tokens: 4200000,
    cost: 0.08,
    custom: false,
  },
  {
    name: "nomic-embed-text",
    type: "embedding",
    tokens: 1500000,
    cost: 0,
    custom: true,
  },
];

export function AnalyticsDashboard() {
  const [activeTab, setActiveTab] = useState("overview");

  const totalChatTokens = MOCK_MODELS.filter((m) => m.type === "chat").reduce(
    (sum, m) => sum + m.tokens,
    0,
  );
  const totalEmbeddingTokens = MOCK_MODELS.filter(
    (m) => m.type === "embedding",
  ).reduce((sum, m) => sum + m.tokens, 0);
  const totalCost = MOCK_MODELS.reduce(
    (sum, m) => sum + (m.custom ? 0 : m.cost),
    0,
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <Activity className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalCost.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              Across all paid models
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Chat Tokens</CardTitle>
            <MessageSquare className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(totalChatTokens / 1000000).toFixed(1)}M
            </div>
            <p className="text-xs text-muted-foreground">
              Processed in conversations
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Embedding Tokens
            </CardTitle>
            <Database className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(totalEmbeddingTokens / 1000000).toFixed(1)}M
            </div>
            <p className="text-xs text-muted-foreground">
              Processed during indexing
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Requests
            </CardTitle>
            <Zap className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {MOCK_SERVER_REQUESTS.reduce(
                (sum, day) => sum + day.requests,
                0,
              ).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              To local RAG server this week
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <TabsList className="bg-white dark:bg-muted">
            <TabsTrigger value="overview">Server Traffic</TabsTrigger>
            <TabsTrigger value="indexing">Indexing Usage</TabsTrigger>
            <TabsTrigger value="chat">Chat Usage</TabsTrigger>
          </TabsList>
          <div className="flex items-center">
            <Select defaultValue="30d">
              <SelectTrigger className="w-[140px] h-10! text-sm bg-white dark:bg-background">
                <SelectValue placeholder="Select timeframe" />
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
          <Card>
            <CardHeader>
              <CardTitle>Requests to RAG Server</CardTitle>
              <CardDescription>
                Daily requests sent to your local or remote deployed RAG
                endpoints.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-2 sm:p-6">
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={MOCK_SERVER_REQUESTS}
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
                    />
                    <YAxis
                      stroke="currentColor"
                      strokeOpacity={0.5}
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${value}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--color-background)",
                        borderColor: "var(--color-border)",
                        borderRadius: "8px",
                      }}
                      itemStyle={{ color: "var(--color-foreground)" }}
                      cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
                    />
                    <Bar
                      dataKey="requests"
                      fill="#3b82f6"
                      radius={[4, 4, 0, 0]}
                      barSize={32}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="indexing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Indexing Token Usage</CardTitle>
              <CardDescription>
                Daily tokens processed for document indexing.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-2 sm:p-6">
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={MOCK_INDEXING_USAGE}
                    margin={{
                      top: 10,
                      right: 30,
                      left: 0,
                      bottom: 0,
                    }}
                  >
                    <defs>
                      <linearGradient
                        id="colorIndexing"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#f97316"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="#f97316"
                          stopOpacity={0}
                        />
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
                    />
                    <YAxis
                      stroke="currentColor"
                      strokeOpacity={0.5}
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) =>
                        `${value >= 1000 ? value / 1000 + "k" : value}`
                      }
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--color-background)",
                        borderColor: "var(--color-border)",
                        borderRadius: "8px",
                      }}
                      itemStyle={{ color: "var(--color-foreground)" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="tokens"
                      stroke="#f97316"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorIndexing)"
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="chat" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Chat Token Usage</CardTitle>
              <CardDescription>
                Daily tokens processed for chat completions.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-2 sm:p-6">
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={MOCK_CHAT_USAGE}
                    margin={{
                      top: 10,
                      right: 30,
                      left: 0,
                      bottom: 0,
                    }}
                  >
                    <defs>
                      <linearGradient
                        id="colorChat"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#3b82f6"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="#3b82f6"
                          stopOpacity={0}
                        />
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
                    />
                    <YAxis
                      stroke="currentColor"
                      strokeOpacity={0.5}
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) =>
                        `${value >= 1000 ? value / 1000 + "k" : value}`
                      }
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--color-background)",
                        borderColor: "var(--color-border)",
                        borderRadius: "8px",
                      }}
                      itemStyle={{ color: "var(--color-foreground)" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="tokens"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorChat)"
                      activeDot={{ r: 4 }}
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
