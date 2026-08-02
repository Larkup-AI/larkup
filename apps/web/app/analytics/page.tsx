import { redirect } from 'next/navigation';

export default function AnalyticsPage() {
  redirect('/settings?section=analytics');
}
