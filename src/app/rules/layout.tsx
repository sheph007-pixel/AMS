import { AdminGuard } from "../admin-guard";

export default function RulesLayout({ children }: { children: React.ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
